import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const { data, error, count } = await supabase.from("projects").select("*", { count: "exact" });
console.log("projects table ->", { count, rowCount: data?.length, error: error?.message });
console.log("sample rows:", JSON.stringify(data?.slice(0, 5), null, 2));
