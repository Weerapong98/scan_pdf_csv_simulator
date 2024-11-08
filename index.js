require('dotenv').config()
const { promises: fs } = require('fs')
const axios = require('axios')
const FormData = require('form-data')
const XLSX = require("xlsx");
const md5File = require('md5-file')

const auth = {
    username: process.env.ALF_USERNAME,
    password: process.env.ALF_PASSWORD
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
        form.append('destination', `workspace://SpacesStore/${parentId}`)
        form.append('overwrite', 'true')

        await axios({
            method: 'POST',
            url: `${process.env.ALF_BASE_SERVICE}api/upload`,
            data: form,
            headers: form.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            auth
        });
    } catch (error) {
        console.log(`ERROR at uploadAlf(${parentId}, file, ${filename}): `, error);
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

async function main() {
    try {
        const pdf_filenames = await fs.readdir(`${process.env.STORAGE_PATH}PDF`)
        const csv_filenames = await fs.readdir(`${process.env.STORAGE_PATH}CSV`)

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
                        const folderList = Object.values(cloneXlData)

                        const folderId = await nestedFolders(process.env.ALF_BASE_NODE, folderList);
                        await uploadAlf(folderId, pdf_file, name);

                        await moveFile(`${process.env.STORAGE_PATH}PDF/${name}`, `${process.env.STORAGE_PATH}RESULT/SUCCESS/${name}`)
                    } else {
                        console.log(`File MD5 hash does not match for: ${name}`);
                        await moveFile(`${process.env.STORAGE_PATH}PDF/${name}`, `${process.env.STORAGE_PATH}RESULT/ERROR/${name}`)
                    }
                } else {
                    console.log(`No matching CSV file for PDF: ${name}`);
                    await moveFile(`${process.env.STORAGE_PATH}PDF/${name}`, `${process.env.STORAGE_PATH}RESULT/ERROR/${name}`)
                }
            }
        }

    } catch (error) {
        console.log("ERROR at main(): ", error);
    }
}

main()