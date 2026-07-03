import { migrate, closePool } from "../ledger/db.js";

await migrate();
console.log("Schema applied to database.");
await closePool();
