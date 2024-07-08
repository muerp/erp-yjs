import { queryHistory, recoverDocument } from './query'
export const router: { [key: string]: (query: any, cbk: (data: any, type?: string) => void) => any } = {
    '/v1/history': queryHistory,
    '/v1/recover': recoverDocument,
}
