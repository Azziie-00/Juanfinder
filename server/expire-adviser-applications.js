// Alternative scheduler entry point: run every minute when pg_cron is unavailable.
require('dotenv').config({ path: require('node:path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
async function run() {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Configure the server Supabase credentials first.');
    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data, error } = await db.rpc('expire_group_adviser_applications');
    if (error) throw new Error(error.message);
    console.log(`Processed ${data} expired adviser applications.`);
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
