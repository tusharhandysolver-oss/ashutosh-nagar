import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dataPath = path.join(root, "data.json");
const db = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const testPattern = /\b(test|testing|demo|sample)\b/i;

const testProjectIds = new Set(
  db.projects
    .filter((project) => testPattern.test(project.name || "") || testPattern.test(project.description || ""))
    .map((project) => project.id)
);
const testTaskIds = new Set(
  db.tasks
    .filter((task) =>
      testProjectIds.has(task.projectId) ||
      testPattern.test(task.title || "") ||
      testPattern.test(task.description || "")
    )
    .map((task) => task.id)
);
const testLeaveIds = new Set(
  (db.leaveRequests || [])
    .filter((leave) => testPattern.test(leave.reason || ""))
    .map((leave) => leave.id)
);
const referencesTestRecord = (text = "") =>
  testPattern.test(text) ||
  [...testTaskIds, ...testProjectIds, ...testLeaveIds].some((id) => text.includes(id));

const before = {
  projects: db.projects.length,
  tasks: db.tasks.length,
  comments: db.comments.length,
  activityLogs: db.activityLogs.length,
  notifications: db.notifications.length,
  leaveRequests: (db.leaveRequests || []).length
};

db.projects = db.projects.filter((project) => !testProjectIds.has(project.id));
db.tasks = db.tasks.filter((task) => !testTaskIds.has(task.id));
db.comments = db.comments.filter((comment) => !testTaskIds.has(comment.taskId) && !testPattern.test(comment.comment || ""));
db.activityLogs = db.activityLogs.filter((log) => !testTaskIds.has(log.taskId) && !referencesTestRecord(log.action || ""));
db.notifications = db.notifications.filter((notification) => !referencesTestRecord(notification.message || ""));
db.leaveRequests = (db.leaveRequests || []).filter((leave) => !testLeaveIds.has(leave.id));

fs.writeFileSync(dataPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");

const after = {
  projects: db.projects.length,
  tasks: db.tasks.length,
  comments: db.comments.length,
  activityLogs: db.activityLogs.length,
  notifications: db.notifications.length,
  leaveRequests: db.leaveRequests.length
};

console.log(JSON.stringify({ removedProjectIds: [...testProjectIds], removedTaskIds: [...testTaskIds], removedLeaveIds: [...testLeaveIds], before, after }, null, 2));
