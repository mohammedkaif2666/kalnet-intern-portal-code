import {
  addDoc,
  collection,
  doc,
  getDocs,
  increment,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  ROLE_INTERN,
  ROLE_RECRUITER,
  TICKET_STATUS,
  TICKET_TYPES,
  copyText,
  createInternAccountAsRecruiter,
  db,
  downloadCsv,
  escapeHtml,
  formatDateTime,
  formatRelativeTime,
  normalizePasswordFromPhone,
  normalizePhone,
  normalizeProfile,
  renderAvatar,
  requireAuth,
  signOutUser,
  sortByName,
  sortByTimestampDesc,
  touchLastLogin,
} from "./portal-core.js";
import { initAssistant } from "./ai-assistant.js";

const dashboardRole = document.body.dataset.dashboardRole;

const deliverableGroups = [
  {
    label: "Phase 1A - ML Foundations (Days 1-14)",
    items: [
      "Day 1: NumPy Exercise Set",
      "Day 2: EDA Report",
      "Day 3: Visualisation Notebook (6 Charts)",
      "Day 4: Concept Summary + Bias-Variance Diagram",
      "Day 5: Linear Regression Model",
      "Day 6: Logistic Regression + Confusion Matrix",
      "Day 7: KNN vs Decision Tree Comparison",
      "Day 8: XGBoost Model",
      "Day 9: SVM Classifier + Kernel Comparison",
      "Day 10: Customer Segmentation Notebook",
      "Day 11: PCA on High-Dimensional Data",
      "Day 12: Hyperparameter-Tuned Model + CV Report",
      "Day 13: Feature Engineering Set",
      "Day 14: scikit-learn Pipeline + Serialised Model",
    ],
  },
  {
    label: "Phase 1B - ML Assignment (Days 15-17)",
    items: [
      "Day 15: EDA + Findings Notebook",
      "Day 16: Model Comparison + Evaluation Report",
      "Day 17: Pipeline + README + Model File (PR)",
    ],
  },
  {
    label: "Phase 1C - Deep Learning (Days 18-27)",
    items: [
      "Day 18: Single-Layer Network in NumPy",
      "Day 19: Loss Curves for 3 Optimisers",
      "Day 20: PyTorch Tensor Operations Notebook",
      "Day 21: MLP Classifier in PyTorch",
      "Day 22: Regularised Training + Val Loss Tracking",
      "Day 23: CNN Image Classifier (CIFAR-10)",
      "Day 24: Fine-Tuned ResNet on Custom Data",
      "Day 25: LSTM Time-Series Forecast",
      "Day 26: Attention Weight Visualisation",
      "Day 27: Sentiment Classification with BERT",
    ],
  },
  {
    label: "Phase 1D - DL Assignment (Days 28-30)",
    items: [
      "Day 28: Training Plan + Dataset Analysis",
      "Day 29: Fine-Tuned Model + Baseline Comparison",
      "Day 30: Model Card + Checkpoint (PR)",
    ],
  },
  {
    label: "Phase 2A - LLMs & AI Agents (Days 31-45)",
    items: [
      "Day 31: LLM Vocab Cheat Sheet + Token Counting",
      "Day 32: Prompt Library (5 Templates)",
      "Day 33: Claude API Integration",
      "Day 34: LCEL Chain + JSON Output",
      "Day 35: Document Ingestion Pipeline",
      "Day 36: Semantic Search (FAISS/Chroma)",
      "Day 37: End-to-End RAG Pipeline",
      "Day 38: Multi-Turn Chatbot + Memory",
      "Day 39: Agent with 3 Custom Tools",
      "Day 40: Multi-Step Agent (Business Query)",
      "Day 41: Planning Agent + Self-Critique",
      "Day 42: Multi-Agent Pipeline (LangGraph)",
      "Day 43: Voice Assistant Prototype",
      "Day 44: RAGAS Evaluation Report",
      "Day 45: Cost Analysis + Guardrails",
    ],
  },
  {
    label: "Phase 2B - LLM Assignment (Days 46-49)",
    items: [
      "Day 46: Agent Architecture Design Doc",
      "Day 47: RAG Chain + Citation Sources",
      "Day 48: Agent + 2 Custom Tools + RAGAS Eval",
      "Day 49: FastAPI Endpoint + Loom Demo (PR)",
    ],
  },
  {
    label: "Phase 2C - MLOps (Days 50-58)",
    items: [
      "Day 50: DVC-Tracked Dataset",
      "Day 51: MLflow Experiment (3 Variants)",
      "Day 52: Model Promoted to Production",
      "Day 53: FastAPI ML Service",
      "Day 54: Dockerised ML Service",
      "Day 55: GitHub Actions CI/CD Pipeline",
      "Day 56: Databricks Notebook",
      "Day 57: Drift Detection Report",
      "Day 58: Shadow Deployment Plan",
    ],
  },
  {
    label: "Phase 2D - MLOps Assignment (Days 59-60)",
    items: [
      "Day 59: MLflow + FastAPI + Docker + CI",
      "Day 60: Drift Report + Model Card (PR)",
    ],
  },
  {
    label: "Phase 3 - Live Project Sprints",
    items: [
      "Sprint 0: Environment Setup",
      "Sprint 1: First ML Task (PR)",
      "Sprint 2: Data Pipeline Module",
      "Sprint 3: LLM-Powered Feature",
      "Sprint 4: Monitoring Dashboard",
      "Sprint 5: Independent Feature",
      "Sprint 6: Final Demo + Handover",
    ],
  },
];

const toastElement = document.getElementById("toast");
const rosterList = document.getElementById("roster-list");
const inspectorEmpty = document.getElementById("inspector-empty");
const inspectorDetail = document.getElementById("inspector-detail");
const meetingControls = document.getElementById("meeting-controls");
const meetingList = document.getElementById("meeting-list");
const ticketControls = document.getElementById("ticket-controls");
const ticketList = document.getElementById("ticket-list");
const feedList = document.getElementById("feed-list");
const qaList = document.getElementById("qa-list");
const roleToolsBody = document.getElementById("role-tools-body");
const roleToolsTitle = document.getElementById("role-tools-title");
const raiseButton = document.getElementById("raise-btn");

let currentUser = null;
let currentProfile = null;
let interns = [];
let meetings = [];
let tickets = [];
let feedItems = [];
let qaItems = [];
let chatItems = [];
let selectedInternUid = null;
let meetingsBootstrapped = false;
const notificationsPreferenceKey = "kalnet-meeting-alerts-enabled";
const meetingSeenKey = "kalnet-seen-meeting-ids";

function toast(message, type = "") {
  toastElement.textContent = message;
  toastElement.className = `toast ${type}`.trim();
  toastElement.classList.add("show");
  window.clearTimeout(toastElement._timer);
  toastElement._timer = window.setTimeout(() => toastElement.classList.remove("show"), 3200);
}

function readSeenMeetingIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(meetingSeenKey) || "[]"));
  } catch {
    return new Set();
  }
}

function storeSeenMeetingIds(ids) {
  localStorage.setItem(meetingSeenKey, JSON.stringify([...ids]));
}

async function requestMeetingNotifications() {
  if (!("Notification" in window)) {
    toast("This browser does not support notifications.", "error");
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    localStorage.setItem(notificationsPreferenceKey, "1");
    toast("Meeting alerts enabled.", "success");
  } else {
    toast("Notifications were not enabled.", "error");
  }
}

async function showMeetingNotification(meeting) {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  const body = `${meeting.title || "New meeting"} · ${formatDateTime(meeting.meetingAt)}`;
  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.showNotification("KALNET Meeting Update", {
        body,
        tag: `meeting-${meeting.id}`,
        icon: "./icons/icon-192.svg",
        badge: "./icons/icon-192.svg",
        data: { url: window.location.href },
      });
      return;
    }
  }

  new Notification("KALNET Meeting Update", { body });
}

async function notifyForNewMeetings(items) {
  const seenIds = readSeenMeetingIds();
  const currentIds = new Set(items.map((meeting) => meeting.id));

  if (!meetingsBootstrapped) {
    meetingsBootstrapped = true;
    storeSeenMeetingIds(currentIds);
    return;
  }

  if (localStorage.getItem(notificationsPreferenceKey) !== "1" || Notification.permission !== "granted") {
    storeSeenMeetingIds(currentIds);
    return;
  }

  for (const meeting of items) {
    if (!seenIds.has(meeting.id) && meeting.createdByUid !== currentUser.uid) {
      await showMeetingNotification(meeting);
    }
  }

  storeSeenMeetingIds(currentIds);
}

function statusClass(status) {
  if (status === "approved") return "status-approved";
  if (status === "done") return "status-done";
  return "status-open";
}

function ticketTypeLabel(type) {
  return TICKET_TYPES[type] || type || "General";
}

function roleLabel(role) {
  return role === ROLE_RECRUITER ? "Recruiter" : "Intern";
}

function getInternByUid(uid) {
  return interns.find((intern) => intern.uid === uid) || null;
}

function updateNavAndUserCard() {
  document.getElementById("nav-avatar").innerHTML = renderAvatar(currentProfile.photoURL, currentProfile.name, 40);
  document.getElementById("nav-name").textContent = (currentProfile.name || "User").split(" ")[0];
  document.getElementById("user-card-photo").innerHTML = renderAvatar(currentProfile.photoURL, currentProfile.name, 84);
  document.getElementById("user-card-name").textContent = currentProfile.name || "User";
  document.getElementById("user-card-email").textContent = currentProfile.email || "";

  const pills = [`<span class="pill pill-role">${escapeHtml(roleLabel(currentProfile.role))}</span>`];
  if (currentProfile.group) {
    pills.push(`<span class="pill pill-group">${escapeHtml(currentProfile.group)}</span>`);
  }
  pills.push(`<span class="pill pill-credits">${escapeHtml(String(currentProfile.credits || 0))} credits</span>`);
  document.getElementById("user-pills").innerHTML = pills.join("");
}

function renderRoster() {
  document.getElementById("intern-count").textContent = String(interns.length);
  if (!interns.length) {
    rosterList.innerHTML = `<div class="empty-state">No students are available yet.</div>`;
    selectedInternUid = null;
    renderInspector();
    return;
  }

  const defaultUid = currentProfile.role === ROLE_INTERN ? currentProfile.uid : interns[0]?.uid;
  if (!selectedInternUid || !getInternByUid(selectedInternUid)) {
    selectedInternUid = defaultUid;
  }

  rosterList.innerHTML = interns
    .map(
      (intern) => `
        <div class="roster-item ${intern.uid === selectedInternUid ? "active" : ""}" data-uid="${escapeHtml(intern.uid)}">
          ${renderAvatar(intern.photoURL, intern.name, 38)}
          <div>
            <div class="roster-name">${escapeHtml(intern.name || "Unnamed student")}</div>
            <div class="roster-meta">${escapeHtml(intern.group || "Unassigned")} · ${escapeHtml(intern.email || "")}</div>
          </div>
        </div>
      `,
    )
    .join("");

  rosterList.querySelectorAll("[data-uid]").forEach((item) => {
    item.addEventListener("click", () => {
      selectedInternUid = item.dataset.uid;
      renderRoster();
      renderInspector();
    });
    item.addEventListener("dblclick", () => {
      window.location.href = `intern-profile.html?uid=${encodeURIComponent(item.dataset.uid)}`;
    });
  });

  renderInspector();
}

function renderInspector() {
  const selected = getInternByUid(selectedInternUid);
  if (!selected) {
    inspectorEmpty.hidden = false;
    inspectorDetail.hidden = true;
    inspectorDetail.innerHTML = "";
    return;
  }

  inspectorEmpty.hidden = true;
  inspectorDetail.hidden = false;
  const links = [];
  if (selected.phone) {
    links.push(`<a class="inspector-link" href="https://wa.me/${escapeHtml(selected.phone)}" target="_blank" rel="noreferrer">WhatsApp</a>`);
  }
  if (selected.github) {
    links.push(`<a class="inspector-link" href="${escapeHtml(selected.github)}" target="_blank" rel="noreferrer">GitHub</a>`);
  }
  if (selected.linkedin) {
    links.push(`<a class="inspector-link" href="${escapeHtml(selected.linkedin)}" target="_blank" rel="noreferrer">LinkedIn</a>`);
  }
  if (selected.portfolio) {
    links.push(`<a class="inspector-link" href="${escapeHtml(selected.portfolio)}" target="_blank" rel="noreferrer">Portfolio</a>`);
  }

  inspectorDetail.innerHTML = `
    <div>${renderAvatar(selected.photoURL, selected.name, 86)}</div>
    <div class="inspector-name">${escapeHtml(selected.name || "Unnamed student")}</div>
    <div class="inspector-email">${escapeHtml(selected.email || "")}</div>
    <div class="pill-row">
      <span class="pill pill-group">${escapeHtml(selected.group || "Unassigned")}</span>
      <span class="pill pill-credits">${escapeHtml(String(selected.credits || 0))} credits</span>
    </div>
    <div class="inspector-links">
      ${links.join("") || `<div class="empty-state">This student has not shared contact links yet.</div>`}
    </div>
    <div class="action-row" style="justify-content:center;margin-top:16px">
      <a class="btn btn-secondary btn-compact" href="intern-profile.html?uid=${encodeURIComponent(selected.uid)}">View Full Profile</a>
    </div>
  `;
}

function renderRoleTools() {
  if (dashboardRole === ROLE_RECRUITER) {
    roleToolsTitle.textContent = "Recruiter Controls";
    roleToolsBody.innerHTML = `
      <div class="helper-note">Only recruiters can create intern accounts. Interns sign in with their email and their phone number as the password.</div>
      <div class="stack">
        <div class="field-row">
          <div class="field">
            <label for="student-name">Student Name</label>
            <input id="student-name" class="control-input" type="text" placeholder="Enter full name" />
          </div>
          <div class="field">
            <label for="student-email">Student Email</label>
            <input id="student-email" class="control-input" type="email" placeholder="student@example.com" />
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="student-phone">Phone Password</label>
            <input id="student-phone" class="control-input" type="tel" placeholder="91XXXXXXXXXX" />
          </div>
          <div class="field">
            <label for="student-group">Assigned Group</label>
            <select id="student-group" class="control-select">
              <option value="Group A">Group A</option>
              <option value="Group B">Group B</option>
              <option value="Group C">Group C</option>
            </select>
          </div>
        </div>
        <button class="btn btn-primary btn-full" id="create-student-btn" type="button">Add Student Account</button>
      </div>
      <div class="stack" style="margin-top:8px">
        <div class="field">
          <label for="download-group">Download by Group</label>
          <select id="download-group" class="control-select">
            <option value="">Choose a group</option>
            <option value="Group A">Group A</option>
            <option value="Group B">Group B</option>
            <option value="Group C">Group C</option>
          </select>
        </div>
        <div class="download-grid">
          <button class="btn btn-secondary btn-compact" id="download-selected-btn" type="button">Download Selected Student</button>
          <button class="btn btn-secondary btn-compact" id="download-group-btn" type="button">Download Chosen Group</button>
          <button class="btn btn-primary btn-compact" id="download-all-btn" type="button">Download All Students</button>
        </div>
      </div>
    `;

    document.getElementById("create-student-btn").addEventListener("click", createStudentAccount);
    document.getElementById("download-selected-btn").addEventListener("click", exportSelectedStudent);
    document.getElementById("download-group-btn").addEventListener("click", exportSelectedGroup);
    document.getElementById("download-all-btn").addEventListener("click", exportAllStudents);
    return;
  }

  roleToolsTitle.textContent = "Submit Deliverable";
  roleToolsBody.innerHTML = `
    <div class="helper-note">Keep your submissions current so recruiters can track momentum without asking for updates manually.</div>
    <div class="field">
      <label for="deliverable-task">Programme Task</label>
      <select id="deliverable-task" class="control-select">
        <option value="">Select a task</option>
        ${deliverableGroups
          .map(
            (group) => `
              <optgroup label="${escapeHtml(group.label)}">
                ${group.items.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}
              </optgroup>
            `,
          )
          .join("")}
      </select>
    </div>
    <div class="field">
      <label for="deliverable-link">Submission Link</label>
      <input id="deliverable-link" class="control-input" type="url" placeholder="GitHub, Colab, Loom, or document URL" />
    </div>
    <button class="btn btn-primary btn-full" id="deliverable-submit-btn" type="button">Push Deliverable</button>
  `;

  document.getElementById("deliverable-submit-btn").addEventListener("click", submitDeliverable);
}

function renderMeetings() {
  const visibleMeetings = [...meetings].sort((left, right) => {
    const leftTime = left.meetingAt?.toDate?.()?.getTime?.() || new Date(left.meetingAt || 0).getTime() || 0;
    const rightTime = right.meetingAt?.toDate?.()?.getTime?.() || new Date(right.meetingAt || 0).getTime() || 0;
    return leftTime - rightTime;
  });

  document.getElementById("meeting-count").textContent = String(visibleMeetings.length);
  meetingList.innerHTML = visibleMeetings.length
    ? visibleMeetings
        .map(
          (meeting) => `
            <div class="meeting-item">
              <div class="meeting-title">${escapeHtml(meeting.title || "Untitled meeting")}</div>
              <div class="meeting-meta">${escapeHtml(formatDateTime(meeting.meetingAt))} · Added by ${escapeHtml(meeting.createdByName || "Recruiter")}</div>
              ${meeting.note ? `<div class="ticket-description">${escapeHtml(meeting.note)}</div>` : ""}
              <div class="meeting-link-row">
                <a class="btn btn-primary btn-compact" href="${escapeHtml(meeting.link || "#")}" target="_blank" rel="noreferrer">Join Meeting</a>
                <button class="btn btn-secondary btn-compact meeting-copy-btn" type="button" data-link="${escapeHtml(meeting.link || "")}">Copy Link</button>
              </div>
            </div>
          `,
        )
        .join("")
    : `<div class="empty-state">No meetings scheduled yet.</div>`;

  meetingList.querySelectorAll(".meeting-copy-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!button.dataset.link) {
        toast("This meeting does not have a link yet.", "error");
        return;
      }
      await copyText(button.dataset.link);
      toast("Meeting link copied.", "success");
    });
  });
}

function renderMeetingControls() {
  if (dashboardRole === ROLE_RECRUITER) {
    meetingControls.innerHTML = `
      <div class="helper-note">Enable browser alerts if you also want to receive notifications when other recruiters schedule or update meetings.</div>
      <div class="action-row">
        <button class="btn btn-secondary btn-compact" id="meeting-alerts-btn" type="button">Enable Meeting Alerts</button>
      </div>
      <div class="field">
        <label for="meeting-title">Meeting Title</label>
        <input id="meeting-title" class="control-input" type="text" placeholder="Weekly standup" />
      </div>
      <div class="field-row">
        <div class="field">
          <label for="meeting-date">Date and Time</label>
          <input id="meeting-date" class="control-input" type="datetime-local" />
        </div>
        <div class="field">
          <label for="meeting-link">Meeting Link</label>
          <input id="meeting-link" class="control-input" type="url" placeholder="https://meet.google.com/..." />
        </div>
      </div>
      <div class="field">
        <label for="meeting-note">Optional Note</label>
        <textarea id="meeting-note" class="control-textarea" placeholder="Agenda, joining instructions, or reminders"></textarea>
      </div>
      <button class="btn btn-primary btn-full" id="meeting-create-btn" type="button">Schedule Meeting</button>
    `;
    document.getElementById("meeting-alerts-btn").addEventListener("click", requestMeetingNotifications);
    document.getElementById("meeting-create-btn").addEventListener("click", createMeeting);
    return;
  }

  meetingControls.innerHTML = `
    <div class="helper-note">Recruiters schedule meetings here. You can join instantly or copy the link for later.</div>
    <div class="action-row">
      <button class="btn btn-secondary btn-compact" id="meeting-alerts-btn" type="button">Enable Meeting Alerts</button>
    </div>
  `;
  document.getElementById("meeting-alerts-btn").addEventListener("click", requestMeetingNotifications);
}

function renderTickets() {
  const visibleTickets = dashboardRole === ROLE_RECRUITER
    ? sortByTimestampDesc(tickets, "createdAt")
    : sortByTimestampDesc(tickets.filter((ticket) => ticket.raisedByUid === currentUser.uid), "createdAt");

  document.getElementById("ticket-count").textContent = String(visibleTickets.length);
  ticketList.innerHTML = visibleTickets.length
    ? visibleTickets
        .map((ticket) => {
          const responseMarkup = ticket.recruiterResponse
            ? `<div class="ticket-response"><strong>Recruiter note:</strong> ${escapeHtml(ticket.recruiterResponse)}</div>`
            : "";
          const controlsMarkup =
            dashboardRole === ROLE_RECRUITER
              ? `
                <div class="field" style="margin-top:14px">
                  <label for="status-${escapeHtml(ticket.id)}">Status</label>
                  <select id="status-${escapeHtml(ticket.id)}" class="control-select ticket-status-select" data-ticket-id="${escapeHtml(ticket.id)}">
                    <option value="open" ${ticket.status === "open" ? "selected" : ""}>${TICKET_STATUS.open}</option>
                    <option value="approved" ${ticket.status === "approved" ? "selected" : ""}>${TICKET_STATUS.approved}</option>
                    <option value="done" ${ticket.status === "done" ? "selected" : ""}>${TICKET_STATUS.done}</option>
                  </select>
                </div>
                <div class="field" style="margin-top:10px">
                  <label for="note-${escapeHtml(ticket.id)}">Recruiter Response</label>
                  <textarea id="note-${escapeHtml(ticket.id)}" class="control-textarea ticket-note-input" data-ticket-id="${escapeHtml(ticket.id)}" placeholder="Add approval details, issue resolution, or follow-up">${escapeHtml(ticket.recruiterResponse || "")}</textarea>
                </div>
                <div class="ticket-response-row">
                  <button class="btn btn-primary btn-compact ticket-save-btn" type="button" data-ticket-id="${escapeHtml(ticket.id)}">Save Update</button>
                </div>
              `
              : "";

          return `
            <div class="ticket-item">
              <div class="action-row" style="justify-content:space-between;align-items:flex-start">
                <div class="ticket-title">${escapeHtml(ticketTypeLabel(ticket.type))}</div>
                <span class="status-chip ${statusClass(ticket.status)}">${escapeHtml(TICKET_STATUS[ticket.status] || "Open")}</span>
              </div>
              <div class="ticket-meta">Raised by ${escapeHtml(ticket.raisedByName || "Student")} · ${escapeHtml(ticket.raisedByGroup || "No group")} · ${escapeHtml(formatRelativeTime(ticket.createdAt))}</div>
              <div class="ticket-description">${escapeHtml(ticket.description || "")}</div>
              ${responseMarkup}
              ${controlsMarkup}
            </div>
          `;
        })
        .join("")
    : `<div class="empty-state">No tickets available yet.</div>`;

  ticketList.querySelectorAll(".ticket-save-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const ticketId = button.dataset.ticketId;
      const statusValue = ticketList.querySelector(`.ticket-status-select[data-ticket-id="${ticketId}"]`)?.value || "open";
      const noteValue = ticketList.querySelector(`.ticket-note-input[data-ticket-id="${ticketId}"]`)?.value.trim() || "";
      try {
        await updateDoc(doc(db, "tickets", ticketId), {
          status: statusValue,
          recruiterResponse: noteValue,
          updatedAt: serverTimestamp(),
        });
        toast("Ticket updated.", "success");
      } catch (error) {
        toast(`Ticket update failed: ${error.message}`, "error");
      }
    });
  });
}

function renderTicketControls() {
  if (dashboardRole === ROLE_RECRUITER) {
    ticketControls.innerHTML = `<div class="helper-note">Interns raise tickets from their dashboard. Use the controls below each ticket to approve absences, resolve website issues, or close assignment-related requests.</div>`;
    return;
  }

  ticketControls.innerHTML = `
    <div class="helper-note">Raise a ticket for meeting absences, assignment submission issues, or website problems. Recruiters respond directly here.</div>
    <div class="field">
      <label for="ticket-type">Ticket Type</label>
      <select id="ticket-type" class="control-select">
        <option value="meeting_absence">${escapeHtml(TICKET_TYPES.meeting_absence)}</option>
        <option value="assignment_delay">${escapeHtml(TICKET_TYPES.assignment_delay)}</option>
        <option value="website_issue">${escapeHtml(TICKET_TYPES.website_issue)}</option>
      </select>
    </div>
    <div class="field">
      <label for="ticket-description">Description</label>
      <textarea id="ticket-description" class="control-textarea" placeholder="Explain the problem so the recruiter can act on it quickly"></textarea>
    </div>
    <button class="btn btn-primary btn-full" id="ticket-submit-btn" type="button">Raise Ticket</button>
  `;

  document.getElementById("ticket-submit-btn").addEventListener("click", raiseTicket);
}

function renderFeed() {
  const items = sortByTimestampDesc(feedItems, "timestamp").slice(0, 30);
  feedList.innerHTML = items.length
    ? items
        .map(
          (item) => `
            <div class="feed-item">
              ${renderAvatar(item.userPhoto, item.userName, 40)}
              <div>
                <div class="feed-title">${escapeHtml(item.userName || "Student")} · ${escapeHtml(item.taskName || "Task")}</div>
                <div class="feed-meta">${escapeHtml(formatRelativeTime(item.timestamp))}</div>
                <a class="feed-link" href="${escapeHtml(item.link || "#")}" target="_blank" rel="noreferrer">Open submission</a>
              </div>
            </div>
          `,
        )
        .join("")
    : `<div class="empty-state">No deliverables have been pushed yet.</div>`;
}

function renderQaBoard() {
  const items = sortByTimestampDesc(qaItems, "timestamp").slice(0, 25);
  qaList.innerHTML = items.length
    ? items
        .map((item) => {
          let actionsMarkup = "";
          if (dashboardRole === ROLE_INTERN) {
            const isAsker = item.askedByUid === currentUser.uid;
            if (item.solved) {
              actionsMarkup = `<div class="qa-status">Solved by ${escapeHtml(item.claimedBy || "a teammate")}</div>`;
            } else if (item.claimedByUid) {
              actionsMarkup = `<div class="qa-status">Claimed by ${escapeHtml(item.claimedBy || "a teammate")}</div>`;
              if (isAsker) {
                actionsMarkup += `<div class="qa-actions"><button class="btn btn-secondary btn-compact qa-resolve-btn" type="button" data-id="${escapeHtml(item.id)}" data-solver="${escapeHtml(item.claimedByUid)}">Mark Resolved and Award Credit</button></div>`;
              }
            } else if (!isAsker) {
              actionsMarkup = `<div class="qa-actions"><button class="btn btn-secondary btn-compact qa-claim-btn" type="button" data-id="${escapeHtml(item.id)}">I can solve this</button></div>`;
            } else {
              actionsMarkup = `<div class="qa-status">Waiting for another intern to claim this.</div>`;
            }
          } else if (item.solved) {
            actionsMarkup = `<div class="qa-status">Solved by ${escapeHtml(item.claimedBy || "a teammate")}</div>`;
          } else if (item.claimedByUid) {
            actionsMarkup = `<div class="qa-status">Claimed by ${escapeHtml(item.claimedBy || "a teammate")}</div>`;
          } else {
            actionsMarkup = `<div class="qa-status">Open for interns to pick up.</div>`;
          }

          return `
            <div class="qa-item">
              <div class="qa-question">${escapeHtml(item.question || "")}</div>
              <div class="qa-meta">Asked by ${escapeHtml(item.askedBy || "Student")} · ${escapeHtml(formatRelativeTime(item.timestamp))}</div>
              ${actionsMarkup}
            </div>
          `;
        })
        .join("")
    : `<div class="empty-state">No doubts have been posted yet.</div>`;

  qaList.querySelectorAll(".qa-claim-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await updateDoc(doc(db, "qa", button.dataset.id), {
          claimedBy: currentProfile.name,
          claimedByUid: currentUser.uid,
        });
        toast("You claimed this doubt.", "success");
      } catch (error) {
        toast(`Could not claim the doubt: ${error.message}`, "error");
      }
    });
  });

  qaList.querySelectorAll(".qa-resolve-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await updateDoc(doc(db, "qa", button.dataset.id), { solved: true });
        await updateDoc(doc(db, "interns", button.dataset.solver), { credits: increment(1) });
        toast("Marked resolved and awarded 1 credit.", "success");
      } catch (error) {
        toast(`Could not resolve the doubt: ${error.message}`, "error");
      }
    });
  });
}

function renderChat() {
  const messages = [...chatItems]
    .sort((left, right) => {
      const leftTime = left.timestamp?.toDate?.()?.getTime?.() || 0;
      const rightTime = right.timestamp?.toDate?.()?.getTime?.() || 0;
      return leftTime - rightTime;
    })
    .slice(-100);

  const chatMessages = document.getElementById("chat-messages");
  chatMessages.innerHTML = messages.length
    ? messages
        .map((message) => {
          const mine = message.senderUid === currentUser.uid;
          return `
            <div class="chat-msg ${mine ? "mine" : "other"}">
              ${mine ? "" : `<div class="chat-msg-header">${renderAvatar(message.senderPhoto, message.senderName, 24)}<span class="chat-msg-name">${escapeHtml(message.senderName || "User")}</span></div>`}
              <div class="chat-bubble">${escapeHtml(message.text || "")}</div>
              <span class="chat-msg-time">${escapeHtml(formatDateTime(message.timestamp))}</span>
            </div>
          `;
        })
        .join("")
    : `<div class="empty-state">No chat messages yet.</div>`;

  window.setTimeout(() => {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }, 50);
}

async function submitDeliverable() {
  const task = document.getElementById("deliverable-task")?.value || "";
  const link = document.getElementById("deliverable-link")?.value.trim() || "";
  if (!task) {
    toast("Choose a programme task first.", "error");
    return;
  }
  if (!link) {
    toast("Paste the submission link before pushing.", "error");
    return;
  }

  try {
    await addDoc(collection(db, "deliverables"), {
      uid: currentUser.uid,
      userName: currentProfile.name,
      userPhoto: currentProfile.photoURL || "",
      taskName: task,
      link,
      timestamp: serverTimestamp(),
    });
    document.getElementById("deliverable-task").value = "";
    document.getElementById("deliverable-link").value = "";
    toast("Deliverable pushed successfully.", "success");
  } catch (error) {
    toast(`Deliverable push failed: ${error.message}`, "error");
  }
}

async function createStudentAccount() {
  const name = document.getElementById("student-name").value.trim();
  const email = document.getElementById("student-email").value.trim();
  const phone = normalizePhone(document.getElementById("student-phone").value);
  const group = document.getElementById("student-group").value;
  const password = normalizePasswordFromPhone(phone);

  if (!name || !email || !phone || !group) {
    toast("Fill every student field before creating the account.", "error");
    return;
  }
  if (!email.includes("@")) {
    toast("Enter a valid student email address.", "error");
    return;
  }
  if (password.length < 6) {
    toast("Phone password must be at least 6 characters.", "error");
    return;
  }

  try {
    await createInternAccountAsRecruiter({ email, group, name, phone }, currentProfile);
    document.getElementById("student-name").value = "";
    document.getElementById("student-email").value = "";
    document.getElementById("student-phone").value = "";
    document.getElementById("student-group").value = "Group A";
    toast("Student account created. They can sign in using email and phone number.", "success");
  } catch (error) {
    toast(`Student creation failed: ${error.message}`, "error");
  }
}

async function createMeeting() {
  const title = document.getElementById("meeting-title").value.trim();
  const meetingDate = document.getElementById("meeting-date").value;
  const link = document.getElementById("meeting-link").value.trim();
  const note = document.getElementById("meeting-note").value.trim();

  if (!title || !meetingDate || !link) {
    toast("Meeting title, date/time, and link are required.", "error");
    return;
  }

  try {
    await addDoc(collection(db, "meetings"), {
      title,
      link,
      note,
      createdByUid: currentUser.uid,
      createdByName: currentProfile.name,
      meetingAt: new Date(meetingDate),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    document.getElementById("meeting-title").value = "";
    document.getElementById("meeting-date").value = "";
    document.getElementById("meeting-link").value = "";
    document.getElementById("meeting-note").value = "";
    toast("Meeting scheduled.", "success");
  } catch (error) {
    toast(`Meeting creation failed: ${error.message}`, "error");
  }
}

async function raiseTicket() {
  const type = document.getElementById("ticket-type").value;
  const description = document.getElementById("ticket-description").value.trim();

  if (!description) {
    toast("Describe the ticket before submitting it.", "error");
    return;
  }

  try {
    await addDoc(collection(db, "tickets"), {
      type,
      description,
      status: "open",
      recruiterResponse: "",
      raisedByUid: currentUser.uid,
      raisedByName: currentProfile.name,
      raisedByEmail: currentProfile.email,
      raisedByGroup: currentProfile.group,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    document.getElementById("ticket-description").value = "";
    document.getElementById("ticket-type").value = "meeting_absence";
    toast("Ticket raised successfully.", "success");
  } catch (error) {
    toast(`Ticket creation failed: ${error.message}`, "error");
  }
}

async function postDoubt() {
  const textarea = document.getElementById("doubt-text");
  const question = textarea.value.trim();
  if (!question) {
    toast("Write the doubt before posting it.", "error");
    return;
  }

  try {
    await addDoc(collection(db, "qa"), {
      question,
      askedBy: currentProfile.name,
      askedByUid: currentUser.uid,
      claimedBy: null,
      claimedByUid: null,
      solved: false,
      timestamp: serverTimestamp(),
    });
    textarea.value = "";
    closeDoubtModal();
    toast("Doubt posted.", "success");
  } catch (error) {
    toast(`Could not post the doubt: ${error.message}`, "error");
  }
}

async function sendChatMessage() {
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text) {
    return;
  }

  input.value = "";
  try {
    await addDoc(collection(db, "chat"), {
      text,
      senderName: currentProfile.name,
      senderUid: currentUser.uid,
      senderPhoto: currentProfile.photoURL || "",
      timestamp: serverTimestamp(),
    });
  } catch (error) {
    toast(`Chat send failed: ${error.message}`, "error");
  }
}

function openDoubtModal() {
  document.getElementById("doubt-modal").classList.add("open");
}

function closeDoubtModal() {
  document.getElementById("doubt-modal").classList.remove("open");
}

async function signOutFromDashboard() {
  await signOutUser();
  window.location.replace("index.html");
}

function listenToCollection(collectionName, onData, options = {}) {
  const { profileMode = false } = options;
  return onSnapshot(collection(db, collectionName), (snapshot) => {
    const items = snapshot.docs.map((documentSnapshot) => {
      const raw = documentSnapshot.data();
      const baseItem = {
        ...raw,
        id: documentSnapshot.id,
        uid: raw.uid || documentSnapshot.id,
      };
      return profileMode ? normalizeProfile(baseItem) : baseItem;
    });
    onData(items);
  });
}

function wireStaticEvents() {
  document.getElementById("logout-btn").addEventListener("click", signOutFromDashboard);
  document.getElementById("mobile-logout").addEventListener("click", signOutFromDashboard);
  document.getElementById("hamburger").addEventListener("click", () => document.getElementById("mobile-menu").classList.toggle("open"));

  const chatFab = document.getElementById("chat-fab");
  const chatPanel = document.getElementById("chat-panel");
  const chatOverlay = document.getElementById("chat-overlay");
  const closeChat = () => {
    chatPanel.classList.remove("open");
    chatOverlay.classList.remove("open");
  };

  chatFab.addEventListener("click", () => {
    chatPanel.classList.add("open");
    chatOverlay.classList.add("open");
  });
  chatOverlay.addEventListener("click", closeChat);
  document.getElementById("chat-close").addEventListener("click", closeChat);
  document.getElementById("chat-send").addEventListener("click", sendChatMessage);
  document.getElementById("chat-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendChatMessage();
    }
  });

  document.getElementById("doubt-cancel").addEventListener("click", closeDoubtModal);
  if (dashboardRole === ROLE_INTERN) {
    raiseButton.addEventListener("click", openDoubtModal);
    document.getElementById("doubt-submit").addEventListener("click", postDoubt);
  } else {
    raiseButton.addEventListener("click", () => toast("Recruiter view is read-only for the Q&A board.", "success"));
  }
}

function buildSummaryMaps(deliverablesDocs, qaDocs, ticketDocs) {
  const summary = {
    deliverables: new Map(),
    doubtsAsked: new Map(),
    doubtsSolved: new Map(),
    ticketsRaised: new Map(),
    ticketsOpen: new Map(),
    ticketsApproved: new Map(),
    ticketsDone: new Map(),
  };

  const bump = (map, uid) => map.set(uid, (map.get(uid) || 0) + 1);

  deliverablesDocs.forEach((item) => {
    if (item.uid) bump(summary.deliverables, item.uid);
  });
  qaDocs.forEach((item) => {
    if (item.askedByUid) bump(summary.doubtsAsked, item.askedByUid);
    if (item.claimedByUid && item.solved) bump(summary.doubtsSolved, item.claimedByUid);
  });
  ticketDocs.forEach((item) => {
    if (item.raisedByUid) bump(summary.ticketsRaised, item.raisedByUid);
    if (item.status === "approved" && item.raisedByUid) bump(summary.ticketsApproved, item.raisedByUid);
    if (item.status === "done" && item.raisedByUid) bump(summary.ticketsDone, item.raisedByUid);
    if ((!item.status || item.status === "open") && item.raisedByUid) bump(summary.ticketsOpen, item.raisedByUid);
  });

  return summary;
}

async function buildExportRows(targetUsers) {
  const [deliverablesSnapshot, qaSnapshot, ticketsSnapshot] = await Promise.all([
    getDocs(collection(db, "deliverables")),
    getDocs(collection(db, "qa")),
    getDocs(collection(db, "tickets")),
  ]);

  const deliverablesDocs = deliverablesSnapshot.docs.map((documentSnapshot) => documentSnapshot.data());
  const qaDocs = qaSnapshot.docs.map((documentSnapshot) => documentSnapshot.data());
  const ticketDocs = ticketsSnapshot.docs.map((documentSnapshot) => documentSnapshot.data());
  const summary = buildSummaryMaps(deliverablesDocs, qaDocs, ticketDocs);

  return targetUsers.map((user) => ({
    Name: user.name || "",
    Email: user.email || "",
    Phone: user.phone || "",
    Role: roleLabel(user.role),
    Group: user.group || "",
    Recruiter: user.createdByRecruiterName || "",
    Credits: user.credits || 0,
    GitHub: user.github || "",
    LinkedIn: user.linkedin || "",
    Portfolio: user.portfolio || "",
    Deliverables: summary.deliverables.get(user.uid) || 0,
    DoubtsAsked: summary.doubtsAsked.get(user.uid) || 0,
    DoubtsSolved: summary.doubtsSolved.get(user.uid) || 0,
    TicketsRaised: summary.ticketsRaised.get(user.uid) || 0,
    TicketsOpen: summary.ticketsOpen.get(user.uid) || 0,
    TicketsApproved: summary.ticketsApproved.get(user.uid) || 0,
    TicketsDone: summary.ticketsDone.get(user.uid) || 0,
    JoinedAt: formatDateTime(user.joinedAt || user.createdAt),
    LastLogin: formatDateTime(user.lastLogin),
  }));
}

async function exportSelectedStudent() {
  const selected = getInternByUid(selectedInternUid);
  if (!selected) {
    toast("Select a student before exporting.", "error");
    return;
  }
  const rows = await buildExportRows([selected]);
  downloadCsv(`${selected.name || "student"}-report.csv`, rows);
  toast("Selected student export downloaded.", "success");
}

async function exportSelectedGroup() {
  const group = document.getElementById("download-group").value;
  if (!group) {
    toast("Choose a group before exporting.", "error");
    return;
  }
  const groupUsers = interns.filter((intern) => intern.group === group);
  if (!groupUsers.length) {
    toast("No students found in that group.", "error");
    return;
  }
  const rows = await buildExportRows(groupUsers);
  downloadCsv(`${group.replaceAll(" ", "-").toLowerCase()}-students.csv`, rows);
  toast("Group export downloaded.", "success");
}

async function exportAllStudents() {
  if (!interns.length) {
    toast("There are no students to export yet.", "error");
    return;
  }
  const rows = await buildExportRows(interns);
  downloadCsv("all-students.csv", rows);
  toast("All student data downloaded.", "success");
}

async function init() {
  const session = await requireAuth({ roles: [dashboardRole] });
  if (!session) {
    return;
  }

  currentUser = session.user;
  currentProfile = session.profile;
  updateNavAndUserCard();
  renderRoleTools();
  renderMeetingControls();
  renderTicketControls();
  wireStaticEvents();
  initAssistant({ toast });

  document.body.classList.add("page-ready");
  touchLastLogin(currentUser.uid);

  listenToCollection("interns", (items) => {
    interns = sortByName(items.filter((item) => item.role !== ROLE_RECRUITER));
    renderRoster();
  }, { profileMode: true });
  listenToCollection("meetings", (items) => {
    meetings = items;
    renderMeetings();
    notifyForNewMeetings(items);
  });
  listenToCollection("tickets", (items) => {
    tickets = items.map((item) => ({ status: "open", ...item }));
    renderTickets();
  });
  listenToCollection("deliverables", (items) => {
    feedItems = items;
    renderFeed();
  });
  listenToCollection("qa", (items) => {
    qaItems = items.map((item) => ({ solved: false, ...item }));
    renderQaBoard();
  });
  listenToCollection("chat", (items) => {
    chatItems = items;
    renderChat();
  });
}

init();
