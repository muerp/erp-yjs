// import startServer from '@editablejs/yjs-websocket/server'

import { MongoDB, PORT } from "./config";
import startServer from "./server";


startServer({
  port: PORT,
  initialValue: {
    children: [
      { text: '' }
    ],
  },
  persistenceOptions: {
    provider: 'mongodb',
    url: MongoDB
  },
  auth: (request) => {
    console.log('鉴权----',request.url);
    return Promise.resolve();
  }
})
