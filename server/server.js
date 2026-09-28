const app = require("./supabase-server");
const port = Number(process.env.PORT || 5000);

app.listen(port, () => console.log(`JuanFinder Supabase API running on http://localhost:${port}`));
