import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const { data: projects } = await supabase.from("projects").select("id").limit(1);
const { data: users } = await supabase.from("users").select("id").limit(1);
const realProjectId = projects?.[0]?.id;
const realUserId = users?.[0]?.id;
console.log("using real project/user:", { realProjectId, realUserId });

const testRow = {
  id: "TSK-DIAG-TEST2",
  title: "diagnostic row",
  description: "test",
  priority: "Low",
  status: "Not Started",
  stage: "Case Intake",
  due_date: "2026-08-01T18:00:00Z",
  created_at: new Date().toISOString(),
  last_updated_date: new Date().toISOString(),
  assigned_by: realUserId,
  assigned_to: realUserId,
  project_id: realProjectId,
  project_name: "test",
  tags: [],
  estimated_hours: 1,
  actual_hours: 0,
  attachments: [],
  is_billable: false,
  hourly_rate: 0,
  client_approval_status: "Not Required",
  matter_code: null,
  started_at: null,
  completed_at: null,
  actual_days_elapsed: null,
  actual_hours_elapsed: null,
  timer_state: "idle",
  last_started_at: null,
  total_active_ms: 0
};

const { error: upsertError } = await supabase.from("tasks").upsert(testRow, { onConflict: "id" });
console.log("UPSERT with real FK ->", { error: upsertError?.message });

const { data: afterRows } = await supabase.from("tasks").select("id");
console.log("tasks after upsert:", afterRows);

await supabase.from("tasks").delete().eq("id", "TSK-DIAG-TEST2");
