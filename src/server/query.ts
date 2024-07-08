import { getPersistence } from "./persistence";
import { docs } from "./utils";
export const queryHistory = (query: any, cbk: (data: any, type?: string) => void) => {
    const dbName = query.id;
    if (!dbName) {
        cbk(JSON.stringify({ code: 1001, error: 'missing parameter id' }));
        return;
    }
    const size = query.size || 10;
    const page = query.page || 0;
    const persistence = getPersistence()

    persistence?.queryHistory({
        docname: dbName,
        size,
        page
    }).then((updates) => {
        if (!updates.length) {
            cbk(JSON.stringify([]))
            return;
        }
        cbk(JSON.stringify(updates));
    })
}


export const recoverDocument = (query: any, cbk: (data: any, type?: string) => void) => {
    const dbName = query.id;
    if (!dbName) {
        cbk(JSON.stringify({ code: 1001, error: 'missing parameter id' }));
        return;
    }
    const persistence = getPersistence()
    persistence?.recoverDocument(dbName, query.clock || 0, docs.get(dbName)).then(() => {
        cbk(JSON.stringify({code: 200}));
    })
}

