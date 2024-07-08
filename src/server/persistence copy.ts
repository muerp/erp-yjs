import { editorElementToYText } from '@editablejs/yjs-transform'
import { Element } from '@editablejs/models'
// import { LeveldbPersistence } from 'y-leveldb'
import * as Y from 'yjs'
import { WSSharedDoc } from './types'
import { MongoAdapterOptions, MongodbPersistence } from './mongodb/persistence'
import { MongoConnectionlOptions } from './mongodb/adapter'
import { MongoClientOptions } from 'mongodb'
import { LeveldbPersistence } from './leveldb/persistence'

type PersistenceProvider = LeveldbPersistence | MongodbPersistence

interface Persistence {
  bindState: (docname: string, doc: WSSharedDoc, initialValue?: Element, options?: any) => void
  writeState: (docname: string, doc: WSSharedDoc, element?: Element) => Promise<void>
  queryHistory: (query: { docname: string, size: number, page: number }) => Promise<{ buffer: number[], time: number }[]>
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

// 间隔5000ms记录历史
const DEFAULT_HISTORY_INTERVAL = 5000

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
        // console.log('000', update)
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

          //全量保存当前状态，用于更新---数据量太大
          // const cur = Y.encodeStateVector(ydoc)
          // ldb!.historyUpdate(docName, cur);
          // _historyTime = nowTime;

          // 快照--当恢复后会丢失数据，官网不建议使用
          // const versions = ydoc.getArray('versions')
          // const prevVersion: any = versions.length === 0 ? null : versions.get(versions.length - 1)
          // const snapshot = Y.snapshot(ydoc);
          // const prevSnapshot = prevVersion === null ? Y.emptySnapshot : Y.decodeSnapshot(prevVersion.snapshot)
          // if (!Y.equalSnapshots(prevSnapshot, snapshot)) {
          //   versions.push([{
          //     date: new Date().getTime(),
          //     snapshot: Y.encodeSnapshot(snapshot),
          //     clientID: ydoc.clientID
          //   }])
          // }
          // _historyTime = nowTime;

          //快照放到表中---失败--记录数据不能完全恢复
          // const versions = ydoc.getArray('versions')
          // const prevVersion: any = versions.length === 0 ? null : versions.get(versions.length - 1)
          // const snapshot = Y.snapshot(ydoc);
          // const prevSnapshot = prevVersion === null ? Y.emptySnapshot : Y.decodeSnapshot(prevVersion.snapshot)
          // if (!Y.equalSnapshots(prevSnapshot, snapshot)) {
          //   const buffer = Y.encodeSnapshot(snapshot);
          //   versions.push([{
          //     date: new Date().getTime(),
          //     snapshot: buffer,
          //     clientID: ydoc.clientID
          //   }])
          //   ldb!.historyUpdate(docName, buffer);
          //   _historyTime = nowTime;
          // }
          // ldb!.saveHistory(docName, ydoc);
          // _historyTime = nowTime;
        }
        // ldb!.historyUpdate(docName, update);
        ldb!.storeUpdate(docName, update)
      })

      // init empty content
      if (content._length === 0 && updateContent._length === 0) {
        ydoc.transact(() => {
          updateContent.insertEmbed(0, editorElementToYText(initialValue))
        })
        _historyDoc.transact(() => {
          updateContent.insertEmbed(0, editorElementToYText(initialValue))
        })
      } else if (content2._length === 0 && updateContent2._length === 0) {
        const initHistoryValue = Y.encodeStateAsUpdate(persistedYdoc);
        Y.applyUpdate(_historyDoc, initHistoryValue)
        ldb!.historyUpdate(docName, initHistoryValue);
        // ldb!.saveHistory(docName, ydoc);
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
    }
  }
}

export const setPersistence = (persistence_: Persistence | null) => {
  persistence = persistence_
}

export const getPersistence = (): null | Persistence => persistence
