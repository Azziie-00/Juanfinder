import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const app = require('../server/supabase-server.js')

export default app