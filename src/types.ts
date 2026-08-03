/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type UserRole = "Admin" | "Manager" | "Team Member";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  avatar?: string;
  phone?: string;
  status?: "active" | "pending";
  createdAt: string;
}

export type TaskPriority = "Critical" | "High" | "Medium" | "Low";

export type TaskStatus = "Not Started" | "In Progress" | "Under Review" | "Blocked" | "Completed";

export type TaskStage = "Case Intake" | "In Progress" | "Completed";

export interface Comment {
  id: string;
  taskId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  comment: string;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  action: string;
}

export interface Task {
  id: string; // TSK-XXXX
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  stage: TaskStage;
  dueDate: string;
  createdAt: string;
  lastUpdatedDate: string;
  assignedBy: string; // UserId
  assignedTo: string; // UserId
  projectId: string;
  projectName: string;
  tags: string[];
  estimatedHours: number;
  actualHours: number;
  attachments: string[]; // Mock file names or URLs
  isBillable?: boolean;
  hourlyRate?: number;
  clientApprovalStatus?: "Approved" | "Pending Review" | "Not Required";
  matterCode?: string;
  startedAt?: string;
  completedAt?: string;
  actualDaysElapsed?: number;
  actualHoursElapsed?: number;
  timerState?: "idle" | "running" | "paused";
  lastStartedAt?: string | null;
  totalActiveMs?: number;
}

export interface Attendance {
  id: string;
  userId: string;
  userName: string;
  date: string; // YYYY-MM-DD
  type: "WFH";
  status: "Open" | "Closed";
  clockInTime: string;
  clockOutTime?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  time: string;
  assigneeIds: string[];
  createdBy?: string;
  createdAt: string;
  remindedUserIds?: string[];
}

export interface LeaveRequest {
  id: string;
  userId: string;
  userName: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: "Pending" | "Approved" | "Rejected";
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  clientName?: string;
  matterCode?: string;
  practiceArea?: string;
  status?: "Active" | "On Hold" | "Closed";
  budget?: number;
  clientEmail?: string;
  clientPhone?: string;
  googleDriveLinks?: string[];
}

export interface AppNotification {
  id: string;
  userId: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  readStatus: boolean;
  createdAt: string;
}

export interface SystemSettings {
  reminderInDays: number;
  enableEmailNotifications: boolean;
  enableUrgentAlerts: boolean;
  autoRiskAnalysis: boolean;
  eventReminderMinutesBefore?: number;
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  assignedTo: string; // Person working on the goal
  accountable: string; // Accountable person
  assignedBy: string; // Goal creator / assigner
  targetDate: string;
  progress: number; // 0 to 100
  status: "Not Started" | "In Progress" | "Completed" | "At Risk";
  accountableNotes?: string;
  createdAt: string;
  updatedAt: string;
}
