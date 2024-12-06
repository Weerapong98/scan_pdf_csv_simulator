require('dotenv').config()
const { promises: fs } = require('fs')
const axios = require('axios')
const XLSX = require("xlsx");
const { log } = require('console');

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

async function main() {
    try {
        const workbook = XLSX.readFile("assets/FolderStructure.xlsx")
        const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets['Matrix']);
        for await (const item of jsonData) {
            let xlsxData = { ...item }
            delete xlsxData['Custom Metadata']
            const folderList = Object.values(xlsxData).map(folder => {
                folder = folder.toString()
                if (folder.includes("/")) {
                    folder = folder.split("/").join("-")
                }
                if (folder.endsWith(".")) {
                    folder = folder.slice(0, -1)
                }
                return folder
            })
            await nestedFolders(process.env.ALF_MATRIX_NODE, folderList);
        }
    } catch (error) {
        console.log(`ERROR at main(): `, error);
    }
}

main()