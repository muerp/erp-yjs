import { editorElementToYText } from '@editablejs/yjs-transform'
import { Element } from '@editablejs/models'
// import { LeveldbPersistence } from 'y-leveldb'
import * as Y from 'yjs'
import { WSSharedDoc } from './types'
import { MongoAdapterOptions, MongodbPersistence } from './mongodb/persistence'
import { MongoConnectionlOptions } from './mongodb/adapter'
import { MongoClientOptions } from 'mongodb'
import { LeveldbPersistence } from './leveldb/persistence'
import { DEFAULT_HISTORY_INTERVAL } from '../config'
import { closeConn, sendRecover } from './utils'

type PersistenceProvider = LeveldbPersistence | MongodbPersistence

interface Persistence {
  bindState: (docname: string, doc: WSSharedDoc, initialValue?: Element, options?: any) => void
  writeState: (docname: string, doc: WSSharedDoc, element?: Element) => Promise<void>
  queryHistory: (query: { docname: string, size: number, page: number }) => Promise<{ buffer: number[], time: number }[]>
  recoverDocument: (docname: string, clock: number, doc?: WSSharedDoc) => Promise<void>
  provider: PersistenceProvider
}

let persistence: null | Persistence = null

interface PersistenceBaseOptions {
  provider: 'leveldb' | 'mongodb'
}

export interface LeveldbPersistenceOptions extends PersistenceBaseOptions {
  provider: 'leveldb'
  dir?: string
}

export interface MongodbPersistenceOptions
  extends PersistenceBaseOptions,
  MongoAdapterOptions,
  MongoClientOptions {
  provider: 'mongodb'
  url: string | MongoConnectionlOptions
}

export type PersistenceOptions = LeveldbPersistenceOptions | MongodbPersistenceOptions

export const initPersistence = async (options: PersistenceOptions, contentField = 'content') => {
  let ldb: PersistenceProvider | null = null
  const { provider, ...others } = options
  if (provider === 'leveldb') {
    const { dir = './db' } = others as LeveldbPersistenceOptions
    console.info('Persisting documents to "' + dir + '"')
    ldb = new LeveldbPersistence(dir)
  } else if (provider === 'mongodb') {
    const { url, flushSize, ...opts } = others as Omit<MongodbPersistenceOptions, 'provider'>
    ldb = new MongodbPersistence(url, { flushSize }, opts)

    console.info('Persisting documents to mongodb')
  }
  if (!ldb) throw new Error('No persistence provider found')

  // let tempDoc: Y.Doc
  persistence = {
    provider: ldb,
    bindState: async (
      docName,
      ydoc,
      initialValue = {
        children: [{ text: '' }],
      },
      options = {
        readOnly: false
      }
    ) => {
      const persistedYdoc = await ldb!.getYDoc(docName)
      const newUpdates = Y.encodeStateAsUpdate(ydoc)
      ldb!.storeUpdate(docName, newUpdates)
      const content = persistedYdoc.get(contentField, Y.XmlText) as Y.XmlText
      const updateContent = ydoc.get(contentField, Y.XmlText) as Y.XmlText
      Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedYdoc))

      let _historyDoc: Y.Doc = await ldb!.getYDoc(docName + '-history');
      const content2 = _historyDoc.get(contentField, Y.XmlText) as Y.XmlText
      const updateContent2 = _historyDoc.get(contentField, Y.XmlText) as Y.XmlText

      let _historyTime = Date.now();
      ydoc.on('update', update => {
        const nowTime = Date.now();
        if (!options.readOnly && nowTime - _historyTime > DEFAULT_HISTORY_INTERVAL) {
          //差量保存
          const stateVector = Y.encodeStateVector(_historyDoc)
          const diff = Y.encodeStateAsUpdate(ydoc, stateVector)
          _historyTime = nowTime;
          if (diff.length > 0) {
            ldb!.historyUpdate(docName, diff);
            Y.applyUpdate(_historyDoc, diff);
          }
        }
        ldb!.storeUpdate(docName, update)
      })

      // init empty content
      if (content._length === 0 && updateContent._length === 0) {
        ydoc.transact(() => {
          updateContent.insertEmbed(0, editorElementToYText(initialValue))
        })
      } 
      if (content2._length === 0 && updateContent2._length === 0) {
        const initHistoryValue = Y.encodeStateAsUpdate(ydoc);
        Y.applyUpdate(_historyDoc, initHistoryValue)
        ldb!.historyUpdate(docName, initHistoryValue);
      }
    },
    writeState: async (docName, ydoc) => {
      return new Promise(resolve => {
        resolve()
      })
    },
    queryHistory: async ({ docname, size, page }: { docname: string, size: number, page: number }) => {
      const updates = await ldb!.queryHistory(docname + '-history', { limit: ~~size, skip: page * size });
      return updates;
    },
    recoverDocument: async (docname: string, clock: number, doc?: WSSharedDoc) => {
      const updates = await ldb!.recoverDocument(docname, clock, doc);

      // 恢复成功后，需要同步其他协作
      if (doc) {
        const ydoc = new Y.Doc()
        ydoc.transact(() => {
          for (let i = 1; i < updates.length; i++) {
            Y.applyUpdate(ydoc, updates[i])
          }
        })
        doc.noUpdate = true;
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(ydoc))
        doc.noUpdate = false;

        for (const [conn] of doc.conns) {
          sendRecover(doc, conn);
        }
      }
    }
  }
}

export const setPersistence = (persistence_: Persistence | null) => {
  persistence = persistence_
}

export const getPersistence = (): null | Persistence => persistence
