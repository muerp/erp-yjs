import { LeveldbPersistence as LevelDB, getLevelUpdates } from 'y-leveldb'
import * as Y from 'yjs';


export class LeveldbPersistence extends LevelDB {
  saveHistory(docName: string, ydoc: Y.Doc)  {
    
  }
  historyUpdate(docName: string, update: Uint8Array) {
    return this.storeUpdate(docName + '-history', update);
  }
  queryHistory(docName: string, opt?: any) {
    const historyName = docName + '-history';
    return this._transact(async db => {
      const updates = await getLevelUpdates(db, historyName)
      return updates;
    })
  }
  async recoverDocument(docName: string, clock: number, doc?: Y.Doc) {

  }
}