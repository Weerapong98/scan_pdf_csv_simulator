require('dotenv').config()
const { promises: fs } = require('fs')
const axios = require('axios')
const FormData = require('form-data')
const XLSX = require("xlsx");
const md5File = require('md5-file')
const pdfParse = require('pdf-parse');

const auth = {
    username: process.env.ALF_USERNAME,
    password: process.env.ALF_PASSWORD
}

const aspectName = "pdf:scanned_pdf"
const aspectForm = {
    "pdf:approver_name": "",
    "pdf:doc_owner_dep": "",
    "pdf:scanned_date": null,
    "pdf:status": "",
    "pdf:note": "",
}

async function nestedFolders(nodeId, folderList = []) {
    try {
        var folderId = nodeId
        const maxItems = 1000

        // loop by folderList
        for await (const folderName of folderList) {
            // get children by folderId
            let hasMoreItems = false
            let skipCount = 0
            let list = []
            do {
                const response = await axios({
                    method: 'GET',
                    url: `${process.env.ALF_BASE_API}alfresco/versions/1/nodes/${folderId}/children`,
                    params: {
                        maxItems,
                        skipCount,
                        where: `(isFolder=true)`,
                        fields: 'id,name',
                    },
                    auth,
                })
                list.push(...response.data.list.entries.map((e) => e.entry))
                list = list.filter((l) => l.name == folderName)

                hasMoreItems = response.data.list.pagination.hasMoreItems
                if (response.data.list.pagination.count <= 0) {
                    hasMoreItems = false
                }
                skipCount += maxItems
            } while (hasMoreItems)

            if (list[0]) {
                // folder has child name == folderName
                folderId = list[0].id
            } else {
                // folder has child name !== folderName => create new child name == folderName
                const newFolder = await axios({
                    method: 'POST',
                    url: `${process.env.ALF_BASE_API}alfresco/versions/1/nodes/${folderId}/children`,
                    data: {
                        name: folderName,
                        nodeType: 'cm:folder',
                    },
                    auth,
                })
                folderId = newFolder.data.entry.id
            }
        }
        return folderId
    } catch (error) {
        console.log(`ERROR at nestedFolders(${nodeId}, ${folderList})`, error);
        return error
    }
}

async function uploadAlf(parentId, file, filename) {
    try {
        var form = new FormData()
        form.append('filedata', file, filename);

        return axios({
            method: 'POST',
            url: `${process.env.ALF_BASE_API}alfresco/versions/1/nodes/${parentId}/children`,
            data: form,
            params: { include: "path", autoRename: true },
            headers: form.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            auth
        });
    } catch (error) {
        console.log(`ERROR at uploadAlf(${parentId}, file, ${filename}): `, error);
    }
}

async function addAspect(nodeId, aspectName, properties = {}) {
    try {
        // 1. get node with aspects and properties
        const nodeRes = await axios({
            method: 'GET',
            url: `${process.env.ALF_BASE_API}alfresco/versions/1/nodes/${nodeId}`,
            params: { include: "aspectNames,properties" },
            auth
        })
        const aspectNames = [...new Set([...nodeRes.data.entry.aspectNames, aspectName].filter(el => el))]

        return axios({
            method: 'PUT',
            url: `${process.env.ALF_BASE_API}alfresco/versions/1/nodes/${nodeId}`,
            params: { include: "aspectNames,properties" },
            data: {
                aspectNames,
                properties
            },
            auth
        })
    } catch (error) {
        console.log(`ERROR at addAspect(${nodeId}, ${aspectName}, ${JSON.stringify(aspectProp)}): `, error);
    }
}

async function moveFile(from, to) {
    try {
        await fs.rename(from, to, (error) => {
            if (error) {
                throw error
            }
        });
    } catch (error) {
        console.log(`ERROR at moveFile(${from}, ${to}): `, error);
    }
}

async function saveLog(path, name, text) {
    try {
        await fs.writeFile(
            `${path}/${name}.log`,
            text,
            { flag: 'a' },
            (error) => {
                throw error
            },
        )
    } catch (error) {
        console.log(`ERROR at saveLog(${path}, ${name}, text): `, error);
    }
}

async function main() {
    try {
        const pdf_filenames = await fs.readdir(`${process.env.STORAGE_PATH}PDF`)
        const csv_filenames = await fs.readdir(`${process.env.STORAGE_PATH}CSV`)

        const timestamp = new Date().toISOString()

        for await (const name of pdf_filenames) {
            const pdf_file = await fs.readFile(`${process.env.STORAGE_PATH}PDF/${name}`)

            if (pdf_file) {
                const csv_filtered = csv_filenames.filter(c => c.replace(".csv", "") === name.replace(".pdf", ""))
                if (csv_filtered[0]) {
                    const workbook = XLSX.readFile(`${process.env.STORAGE_PATH}CSV/${csv_filtered[0]}`);
                    const sheet_name_list = workbook.SheetNames;
                    const xlData = XLSX.utils.sheet_to_json(workbook.Sheets[sheet_name_list[0]]);

                    const hash = await md5File(`${process.env.STORAGE_PATH}PDF/${name}`)

                    if (hash === xlData[0]['MD5 Code']) {
                        let cloneXlData = { ...xlData[0] }
                        delete cloneXlData.Filename
                        delete cloneXlData['Date Time']
                        delete cloneXlData['MD5 Code']

                        // remove Department and Document_Path
                        delete cloneXlData.Department
                        delete cloneXlData.Document_Path

                        // get pdf data
                        const pdfData = await pdfParse(pdf_file);

                        const folderList = Object.values(cloneXlData)
                        const folderId = await nestedFolders(process.env.ALF_BASE_NODE, folderList);

                        const uploadRes = await uploadAlf(folderId, pdf_file, name);

                        await addAspect(uploadRes.data.entry.id, aspectName, { ...aspectForm, "pdf:numpages": pdfData.numpages })

                        await saveLog("logs/SUCCESS", timestamp.split('T')[0], `[${timestamp}]: ${name}\n\tid: ${uploadRes.data.entry.id}\n\tpath: ${uploadRes.data.entry.path.name}/${name}\n\n`)
                        await moveFile(`${process.env.STORAGE_PATH}PDF/${name}`, `${process.env.STORAGE_PATH}RESULT/SUCCESS/${name}`)
                    } else {
                        await saveLog("logs/ERROR", timestamp.split('T')[0], `[${timestamp}]: ${name}\n\tmessage: File MD5 hash does not match for "${name}"\n\n`)
                        await moveFile(`${process.env.STORAGE_PATH}PDF/${name}`, `${process.env.STORAGE_PATH}RESULT/ERROR/${name}`)
                    }
                } else {
                    await saveLog("logs/ERROR", timestamp.split('T')[0], `[${timestamp}]: ${name}\n\tmessage: No matching CSV file for PDF "${name}"\n\n`)
                    await moveFile(`${process.env.STORAGE_PATH}PDF/${name}`, `${process.env.STORAGE_PATH}RESULT/ERROR/${name}`)
                }
            }
        }

    } catch (error) {
        console.log("ERROR at main(): ", error);
    }
}

main()