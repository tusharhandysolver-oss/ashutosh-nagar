import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const todayIst = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
}).formatToParts(new Date());
const value = (type) => todayIst.find((p) => p.type === type)?.value;
const todayStr = `${value("year")}-${value("month")}-${value("day")}`;

const { data: allRows, error: fetchError } = await supabase.from("attendances").select("*");
if (fetchError) {
  console.error("Failed to fetch attendances:", fetchError.message);
  process.exit(1);
}

const toDelete = allRows.filter((r) => r.date < todayStr);
const toKeep = allRows.filter((r) => r.date >= todayStr);

const backupPath = path.join(process.cwd(), `attendances.before-delete-old-${todayStr}.json`);
fs.writeFileSync(backupPath, JSON.stringify(allRows, null, 2), "utf8");

if (toDelete.length === 0) {
  console.log(JSON.stringify({ todayStr, totalRows: allRows.length, deleted: 0, kept: toKeep.length, backupPath }, null, 2));
  process.exit(0);
}

const { error: deleteError } = await supabase
  .from("attendances")
  .delete()
  .lt("date", todayStr);

if (deleteError) {
  console.error("Failed to delete old attendances:", deleteError.message);
  process.exit(1);
}

console.log(JSON.stringify({
  todayStr,
  totalRowsBefore: allRows.length,
  deleted: toDelete.length,
  kept: toKeep.length,
  backupPath
}, null, 2));
