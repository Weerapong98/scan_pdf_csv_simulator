require('dotenv').config()
const { promises: fs } = require('fs')
const axios = require('axios')
const XLSX = require("xlsx");

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

function formatName(name) {
    if (name.includes("/")) {
        name = name.split("/").join("-")
    }
    if (name.includes("|")) {
        name = name.split("|").join("-")
    }
    return name
}

async function main() {
    try {
        const workbook = XLSX.readFile("assets/FolderStructure.xlsx")
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Sheet1'], { header: 1 });
        for await (const row of rows) {
            await nestedFolders(process.env.ALF_MATRIX_NODE, row.map(r => formatName(r.toString())).filter(r => r));

        }
    } catch (error) {
        console.log(`ERROR at main(): `, error);
    }
}

main()