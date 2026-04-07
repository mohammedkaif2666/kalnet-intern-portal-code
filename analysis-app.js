import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  ROLE_INTERN,
  ROLE_RECRUITER,
  db,
  downloadCsv,
  escapeHtml,
  formatDateTime,
  normalizeProfile,
  renderAvatar,
  requireAuth,
  signOutUser,
  sortByName,
  touchLastLogin,
} from "./portal-core.js";

const toastElement = document.getElementById("toast");
const navAvatar = document.getElementById("nav-avatar");
const navName = document.getElementById("nav-name");
const userCardPhoto = document.getElementById("user-card-photo");
const userCardName = document.getElementById("user-card-name");
const userCardEmail = document.getElementById("user-card-email");
const userPills = document.getElementById("user-pills");
const analysisGroupFilter = document.getElementById("analysis-group-filter");
const analysisSort = document.getElementById("analysis-sort");
const analysisStudentSelect = document.getElementById("analysis-student-select");
const analysisStateBadge = document.getElementById("analysis-state-badge");
const analysisUpdatedAt = document.getElementById("analysis-updated-at");
const summaryGrid = document.getElementById("summary-grid");
const leaderboardCount = document.getElementById("leaderboard-count");
const leaderboardChart = document.getElementById("leaderboard-chart");
const tableCount = document.getElementById("table-count");
const analysisTableBody = document.getElementById("analysis-table-body");
const topCandidateScore = document.getElementById("top-candidate-score");
const topRecommendation = document.getElementById("top-recommendation");
const groupCount = document.getElementById("group-count");
const groupChart = document.getElementById("group-chart");
const focusedStudentBadge = document.getElementById("focused-student-badge");
const studentDetail = document.getElementById("student-detail");
const aiStatusBadge = document.getElementById("ai-status-badge");
const aiInsightsBox = document.getElementById("ai-insights-box");
const refreshAiButton = document.getElementById("refresh-ai-btn");
const exportCurrentButton = document.getElementById("export-current-btn");
const exportSelectedButton = document.getElementById("export-selected-analysis-btn");
const exportSelectionReportButton = document.getElementById("export-selection-report-btn");
const attendanceMeetingSelect = document.getElementById("attendance-meeting-select");
const attendanceList = document.getElementById("attendance-list");
const attendanceCoverageBadge = document.getElementById("attendance-coverage-badge");

const dayInMs = 24 * 60 * 60 * 1000;
const scoreWeights = {
  deliverables: 0.42,
  meetings: 0.28,
  collaboration: 0.18,
  consistency: 0.07,
  profile: 0.05,
};

let currentUser = null;
let currentProfile = null;
let interns = [];
let meetings = [];
let deliverables = [];
let qaItems = [];
let tickets = [];
let attendanceRecords = [];
let analysisRecords = [];
let filteredRecords = [];
let groupSummaries = [];
let selectedStudentUid = "";
let selectedMeetingId = "";
let aiRefreshTimer = null;
let aiRequestInFlight = false;
let aiDirty = false;
let aiInsights = {
  status: "pending",
  cohortSummary: "",
  topCandidateUid: "",
  topCandidateReason: "",
  groupInsights: [],
  studentReasons: new Map(),
  selectionCaveat: "",
  updatedAt: null,
};

function toast(message, type = "") {
  toastElement.textContent = message;
  toastElement.className = `toast ${type}`.trim();
  toastElement.classList.add("show");
  window.clearTimeout(toastElement._timer);
  toastElement._timer = window.setTimeout(() => toastElement.classList.remove("show"), 3200);
}

function toTime(value) {
  if (!value) {
    return 0;
  }
  if (typeof value === "number") {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value.toDate === "function") {
    return value.toDate().getTime();
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizedScore(value, maxValue, neutralFallback = 0) {
  if (maxValue <= 0) {
    return neutralFallback;
  }
  return clamp((value / maxValue) * 100);
}

function weekKey(timestamp) {
  const date = new Date(timestamp);
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((utcDate - yearStart) / dayInMs) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-${String(weekNumber).padStart(2, "0")}`;
}

function humanTime(timestamp) {
  if (!timestamp) {
    return "Not updated yet";
  }
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function roleLabel(role) {
  return role === ROLE_RECRUITER ? "Recruiter" : "Intern";
}

function recommendationClass(recommendation) {
  if (recommendation === "Recommended for full-time") return "recommended";
  if (recommendation === "Strong shortlist") return "shortlist";
  if (recommendation === "Needs observation") return "observe";
  return "not-ready";
}

function getAttendanceDocId(meetingId, studentUid) {
  return `${meetingId}__${studentUid}`;
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

function updateUserCard() {
  navAvatar.innerHTML = renderAvatar(currentProfile.photoURL, currentProfile.name, 40);
  navName.textContent = (currentProfile.name || "Recruiter").split(" ")[0];
  userCardPhoto.innerHTML = renderAvatar(currentProfile.photoURL, currentProfile.name, 84);
  userCardName.textContent = currentProfile.name || "Recruiter";
  userCardEmail.textContent = currentProfile.email || "";
  userPills.innerHTML = [
    `<span class="pill pill-role">${escapeHtml(roleLabel(currentProfile.role))}</span>`,
    `<span class="pill pill-group">${escapeHtml(currentProfile.group || "Recruiter")}</span>`,
    `<span class="pill pill-credits">${escapeHtml(String(currentProfile.credits || 0))} credits</span>`,
  ].join("");
}

function buildGroupedMap(items, keySelector) {
  const grouped = new Map();
  items.forEach((item) => {
    const key = keySelector(item);
    if (!key) {
      return;
    }
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(item);
  });
  return grouped;
}

function buildLocalReason(record) {
  const strengths = [];
  const concerns = [];

  if (record.deliverableScore >= 78) {
    strengths.push("strong submission consistency compared with the current cohort");
  } else if (record.deliverablesCount > 0) {
    strengths.push("has started building delivery momentum through submitted work");
  }

  if (record.meetingScore >= 78) {
    strengths.push("reliable meeting attendance and schedule discipline");
  } else if (!record.attendanceMarkedCount && meetings.length) {
    concerns.push("meeting attendance is not fully marked yet, so reliability still needs recruiter confirmation");
  } else if (record.meetingScore < 55) {
    concerns.push("meeting reliability needs improvement before a hiring recommendation becomes strong");
  }

  if (record.collaborationScore >= 68) {
    strengths.push("actively supports peers by clearing doubts and earning contribution credit");
  } else if (record.doubtsSolvedCount === 0) {
    concerns.push("there is still limited evidence of peer support or doubt resolution");
  }

  if (record.consistencyScore >= 68) {
    strengths.push("shows steady week-over-week activity instead of one-off output");
  }

  if (record.openAssignmentIssues > 0) {
    concerns.push("open assignment issue tickets reduce execution confidence right now");
  }

  if (record.openMeetingIssues > 0) {
    concerns.push("meeting absence requests are still visible in the current record");
  }

  if (!record.profileStrengthCount) {
    concerns.push("professional links and profile signals are still incomplete");
  }

  if (!strengths.length) {
    strengths.push("current activity exists, but the advantage over peers is not yet strong");
  }

  const leadStrength = strengths[0];
  const leadConcern = concerns[0];

  if (record.recommendation === "Recommended for full-time") {
    return {
      strengths,
      concerns,
      summary: `Select ${record.name} because of ${leadStrength}${leadConcern ? ` while still monitoring ${leadConcern}` : ""}.`,
    };
  }

  if (record.recommendation === "Strong shortlist") {
    return {
      strengths,
      concerns,
      summary: `${record.name} is a strong shortlist candidate because of ${leadStrength}, but ${leadConcern || "one more cycle of consistent delivery would make the case stronger"}.`,
    };
  }

  if (record.recommendation === "Needs observation") {
    return {
      strengths,
      concerns,
      summary: `${record.name} should stay under observation: ${leadStrength}, but ${leadConcern || "the overall evidence is still not strong enough for final selection"}.`,
    };
  }

  return {
    strengths,
    concerns,
    summary: `${record.name} is not ready yet because ${leadConcern || "the measurable delivery, attendance, and support signals are still too weak"}.`,
  };
}

function computeAnalysis() {
  const deliverablesByUid = buildGroupedMap(deliverables, (item) => item.uid);
  const doubtsAskedByUid = buildGroupedMap(qaItems, (item) => item.askedByUid);
  const doubtsSolvedByUid = buildGroupedMap(
    qaItems.filter((item) => item.claimedByUid && item.solved),
    (item) => item.claimedByUid,
  );
  const ticketsByUid = buildGroupedMap(tickets, (item) => item.raisedByUid);
  const attendanceByUid = buildGroupedMap(
    attendanceRecords.filter((item) => item.status && item.status !== "unmarked"),
    (item) => item.studentUid,
  );

  const now = Date.now();
  const recentCutoff = now - (21 * dayInMs);

  const baseRecords = interns.map((student) => {
    const studentDeliverables = deliverablesByUid.get(student.uid) || [];
    const studentDoubtsAsked = doubtsAskedByUid.get(student.uid) || [];
    const studentDoubtsSolved = doubtsSolvedByUid.get(student.uid) || [];
    const studentTickets = ticketsByUid.get(student.uid) || [];
    const studentAttendance = attendanceByUid.get(student.uid) || [];

    const deliverableTimes = studentDeliverables.map((item) => toTime(item.timestamp)).filter(Boolean);
    const solvedTimes = studentDoubtsSolved.map((item) => toTime(item.timestamp)).filter(Boolean);
    const askedTimes = studentDoubtsAsked.map((item) => toTime(item.timestamp)).filter(Boolean);
    const ticketTimes = studentTickets.map((item) => Math.max(toTime(item.updatedAt), toTime(item.createdAt))).filter(Boolean);
    const attendanceTimes = studentAttendance.map((item) => Math.max(toTime(item.updatedAt), toTime(item.meetingAt))).filter(Boolean);
    const activityTimes = [
      ...deliverableTimes,
      ...solvedTimes,
      ...askedTimes,
      ...ticketTimes,
      ...attendanceTimes,
      toTime(student.lastLogin),
    ].filter(Boolean);

    const attendanceMarkedCount = studentAttendance.length;
    const meetingsAttended = studentAttendance.filter((item) => item.status === "attended").length;
    const meetingsExcused = studentAttendance.filter((item) => item.status === "excused").length;
    const meetingsAbsent = studentAttendance.filter((item) => item.status === "absent").length;
    const attendanceRate = attendanceMarkedCount
      ? ((meetingsAttended + (meetingsExcused * 0.65)) / attendanceMarkedCount) * 100
      : (meetings.length ? 55 : 65);

    const recentDeliverablesCount = deliverableTimes.filter((time) => time >= recentCutoff).length;
    const recentActivityCount = activityTimes.filter((time) => time >= recentCutoff).length;
    const weeksActive = new Set(activityTimes.map((time) => weekKey(time))).size;
    const profileStrengthCount = [student.github, student.linkedin, student.portfolio, student.photoURL].filter(Boolean).length;
    const openAssignmentIssues = studentTickets.filter((item) => item.type === "assignment_delay" && item.status !== "done").length;
    const openMeetingIssues = studentTickets.filter((item) => item.type === "meeting_absence" && item.status !== "done").length;
    const openWebsiteIssues = studentTickets.filter((item) => item.type === "website_issue" && item.status !== "done").length;

    return {
      uid: student.uid,
      name: student.name || "Unnamed student",
      email: student.email || "",
      group: student.group || "Unassigned",
      phone: student.phone || "",
      photoURL: student.photoURL || "",
      github: student.github || "",
      linkedin: student.linkedin || "",
      portfolio: student.portfolio || "",
      credits: Number(student.credits || 0),
      createdByRecruiterName: student.createdByRecruiterName || "",
      deliverablesCount: studentDeliverables.length,
      recentDeliverablesCount,
      doubtsAskedCount: studentDoubtsAsked.length,
      doubtsSolvedCount: studentDoubtsSolved.length,
      attendanceMarkedCount,
      meetingsAttended,
      meetingsExcused,
      meetingsAbsent,
      attendanceRate,
      weeksActive,
      recentActivityCount,
      profileStrengthCount,
      openAssignmentIssues,
      openMeetingIssues,
      openWebsiteIssues,
      latestActivityAt: activityTimes.length ? Math.max(...activityTimes) : 0,
    };
  });

  const maxima = {
    deliverables: Math.max(...baseRecords.map((item) => item.deliverablesCount), 0),
    recentDeliverables: Math.max(...baseRecords.map((item) => item.recentDeliverablesCount), 0),
    doubtsSolved: Math.max(...baseRecords.map((item) => item.doubtsSolvedCount), 0),
    credits: Math.max(...baseRecords.map((item) => item.credits), 0),
    weeksActive: Math.max(...baseRecords.map((item) => item.weeksActive), 0),
    recentActivity: Math.max(...baseRecords.map((item) => item.recentActivityCount), 0),
  };

  const records = baseRecords
    .map((record) => {
      const daysSinceActivity = record.latestActivityAt ? ((now - record.latestActivityAt) / dayInMs) : 999;
      const recencyScore = clamp(100 - (daysSinceActivity * 4), 0, 100);
      const deliverableScore = clamp(
        (normalizedScore(record.deliverablesCount, maxima.deliverables, record.deliverablesCount ? 65 : 0) * 0.75)
        + (normalizedScore(record.recentDeliverablesCount, maxima.recentDeliverables, record.recentDeliverablesCount ? 65 : 0) * 0.25),
      );
      const collaborationScore = clamp(
        (normalizedScore(record.doubtsSolvedCount, maxima.doubtsSolved, record.doubtsSolvedCount ? 60 : 0) * 0.8)
        + (normalizedScore(record.credits, maxima.credits, record.credits ? 60 : 0) * 0.2),
      );
      const consistencyScore = clamp(
        (normalizedScore(record.weeksActive, maxima.weeksActive, record.weeksActive ? 60 : 0) * 0.55)
        + (normalizedScore(record.recentActivityCount, maxima.recentActivity, record.recentActivityCount ? 65 : 0) * 0.25)
        + (recencyScore * 0.2),
      );
      const profileScore = clamp((record.profileStrengthCount / 4) * 100);
      const meetingScore = clamp(record.attendanceRate);
      const riskPenalty = Math.min(18, (record.openAssignmentIssues * 6) + (record.openMeetingIssues * 4) + (record.openWebsiteIssues * 2));
      const overallScore = clamp(
        (deliverableScore * scoreWeights.deliverables)
        + (meetingScore * scoreWeights.meetings)
        + (collaborationScore * scoreWeights.collaboration)
        + (consistencyScore * scoreWeights.consistency)
        + (profileScore * scoreWeights.profile)
        - riskPenalty,
      );

      let recommendation = "Not ready yet";
      if (overallScore >= 80 && record.deliverablesCount > 0 && (record.attendanceMarkedCount === 0 || meetingScore >= 70)) {
        recommendation = "Recommended for full-time";
      } else if (overallScore >= 68) {
        recommendation = "Strong shortlist";
      } else if (overallScore >= 55) {
        recommendation = "Needs observation";
      }

      const localReason = buildLocalReason({
        ...record,
        deliverableScore,
        collaborationScore,
        consistencyScore,
        meetingScore,
        profileScore,
        overallScore,
        recommendation,
      });

      return {
        ...record,
        deliverableScore,
        collaborationScore,
        consistencyScore,
        meetingScore,
        profileScore,
        overallScore,
        riskPenalty,
        recommendation,
        strengths: localReason.strengths,
        concerns: localReason.concerns,
        localReason: localReason.summary,
      };
    })
    .sort((left, right) => right.overallScore - left.overallScore)
    .map((record, index) => ({
      ...record,
      rank: index + 1,
    }));

  const groups = Array.from(
    records.reduce((map, record) => {
      if (!map.has(record.group)) {
        map.set(record.group, []);
      }
      map.get(record.group).push(record);
      return map;
    }, new Map()),
  )
    .map(([group, groupRecords]) => ({
      group,
      size: groupRecords.length,
      avgScore: average(groupRecords.map((item) => item.overallScore)),
      avgDeliverables: average(groupRecords.map((item) => item.deliverablesCount)),
      avgAttendance: average(groupRecords.map((item) => item.meetingScore)),
      avgDoubtsSolved: average(groupRecords.map((item) => item.doubtsSolvedCount)),
      topCandidate: groupRecords[0] || null,
    }))
    .sort((left, right) => right.avgScore - left.avgScore);

  analysisRecords = records;
  groupSummaries = groups;
}

function getFilteredRecords() {
  const groupValue = analysisGroupFilter.value || "all";
  const sortValue = analysisSort.value || "score_desc";

  let records = [...analysisRecords];
  if (groupValue !== "all") {
    records = records.filter((record) => record.group === groupValue);
  }

  const sorters = {
    score_desc: (left, right) => right.overallScore - left.overallScore,
    deliverables_desc: (left, right) => right.deliverablesCount - left.deliverablesCount || right.overallScore - left.overallScore,
    attendance_desc: (left, right) => right.meetingScore - left.meetingScore || right.overallScore - left.overallScore,
    doubts_desc: (left, right) => right.doubtsSolvedCount - left.doubtsSolvedCount || right.overallScore - left.overallScore,
    credits_desc: (left, right) => right.credits - left.credits || right.overallScore - left.overallScore,
    name_asc: (left, right) => left.name.localeCompare(right.name),
  };

  records.sort(sorters[sortValue] || sorters.score_desc);
  records = records.map((record, index) => ({ ...record, filteredRank: index + 1 }));
  filteredRecords = records;
  return records;
}

function getSelectedRecord() {
  const records = filteredRecords.length ? filteredRecords : getFilteredRecords();
  if (!records.length) {
    return null;
  }
  if (!selectedStudentUid || !records.some((record) => record.uid === selectedStudentUid)) {
    selectedStudentUid = records[0].uid;
  }
  return records.find((record) => record.uid === selectedStudentUid) || records[0];
}

function updateFilterOptions() {
  const previousGroup = analysisGroupFilter.value || "all";
  const previousStudent = selectedStudentUid;
  const groups = ["all", ...new Set(analysisRecords.map((record) => record.group))];
  analysisGroupFilter.innerHTML = groups
    .map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group === "all" ? "All Groups" : group)}</option>`)
    .join("");
  analysisGroupFilter.value = groups.includes(previousGroup) ? previousGroup : "all";

  const visibleRecords = getFilteredRecords();
  analysisStudentSelect.innerHTML = [
    `<option value="">Auto select top candidate</option>`,
    ...visibleRecords.map((record) => `<option value="${escapeHtml(record.uid)}">${escapeHtml(record.name)} · ${escapeHtml(record.group)}</option>`),
  ].join("");
  selectedStudentUid = visibleRecords.some((record) => record.uid === previousStudent) ? previousStudent : (visibleRecords[0]?.uid || "");
  analysisStudentSelect.value = selectedStudentUid || "";
}

function renderSummaryCards() {
  if (!filteredRecords.length) {
    summaryGrid.innerHTML = `<div class="empty-state">No students match the current filters.</div>`;
    return;
  }

  const strongestGroup = groupSummaries[0];
  const recommendedCount = filteredRecords.filter((record) => record.recommendation === "Recommended for full-time").length;
  const attendanceMarked = filteredRecords.reduce((sum, record) => sum + record.attendanceMarkedCount, 0);
  const theoreticalAttendance = meetings.length * filteredRecords.length;
  const attendanceCoverage = theoreticalAttendance ? Math.round((attendanceMarked / theoreticalAttendance) * 100) : 100;

  const cards = [
    {
      label: "Students In View",
      value: String(filteredRecords.length),
      note: `${recommendedCount} currently clear the strongest full-time threshold.`,
    },
    {
      label: "Average Cohort Score",
      value: average(filteredRecords.map((record) => record.overallScore)).toFixed(1),
      note: "Weighted from deliverables, meetings, collaboration, and consistency.",
    },
    {
      label: "Strongest Group",
      value: strongestGroup ? escapeHtml(strongestGroup.group) : "No group",
      note: strongestGroup
        ? `Average score ${strongestGroup.avgScore.toFixed(1)} across ${strongestGroup.size} students.`
        : "Waiting for student data.",
    },
    {
      label: "Attendance Coverage",
      value: `${attendanceCoverage}%`,
      note: theoreticalAttendance
        ? "Higher coverage makes the recommendation engine more reliable."
        : "No meetings are scheduled yet, so attendance is neutral.",
    },
  ];

  summaryGrid.innerHTML = cards
    .map(
      (card) => `
        <div class="summary-card">
          <div class="summary-label">${card.label}</div>
          <div class="summary-value">${card.value}</div>
          <div class="summary-note">${card.note}</div>
        </div>
      `,
    )
    .join("");
}

function renderLeaderboard() {
  const topRecords = filteredRecords.slice(0, 8);
  leaderboardCount.textContent = `${filteredRecords.length} students`;
  leaderboardChart.innerHTML = topRecords.length
    ? topRecords
        .map(
          (record) => `
            <div class="chart-row">
              <div class="chart-label">
                ${escapeHtml(record.name)}
                <span class="chart-meta">${escapeHtml(record.group)} · ${escapeHtml(record.recommendation)}</span>
              </div>
              <div class="chart-track">
                <div class="chart-fill" style="width:${clamp(record.overallScore)}%"></div>
              </div>
              <div class="chart-value">${record.overallScore.toFixed(1)}</div>
            </div>
          `,
        )
        .join("")
    : `<div class="empty-state">No leaderboard data is available for this filter.</div>`;
}

function renderGroupChart() {
  groupCount.textContent = `${groupSummaries.length} groups`;
  groupChart.innerHTML = groupSummaries.length
    ? groupSummaries
        .map(
          (group) => `
            <div class="chart-row">
              <div class="chart-label">
                ${escapeHtml(group.group)}
                <span class="chart-meta">${escapeHtml(String(group.size))} students · ${group.topCandidate ? `Top: ${escapeHtml(group.topCandidate.name)}` : "No top candidate"}</span>
              </div>
              <div class="chart-track">
                <div class="chart-fill group" style="width:${clamp(group.avgScore)}%"></div>
              </div>
              <div class="chart-value">${group.avgScore.toFixed(1)}</div>
            </div>
          `,
        )
        .join("")
    : `<div class="empty-state">No group comparison is available yet.</div>`;
}

function renderTable() {
  tableCount.textContent = `${filteredRecords.length} rows`;
  analysisTableBody.innerHTML = filteredRecords.length
    ? filteredRecords
        .map((record) => {
          const aiReason = aiInsights.studentReasons.get(record.uid) || "";
          const finalReason = aiReason || record.localReason;
          return `
            <tr data-student-row="${escapeHtml(record.uid)}">
              <td>${record.filteredRank}</td>
              <td>
                <div class="inline-student">
                  ${renderAvatar(record.photoURL, record.name, 34)}
                  <div class="inline-student-meta">
                    <strong>${escapeHtml(record.name)}</strong>
                    <span>${escapeHtml(record.email)}</span>
                  </div>
                </div>
              </td>
              <td>${escapeHtml(record.group)}</td>
              <td><span class="score-pill">${record.overallScore.toFixed(1)}</span></td>
              <td>${record.deliverablesCount}</td>
              <td>${record.attendanceMarkedCount ? `${record.meetingScore.toFixed(0)}%` : "Pending"}</td>
              <td>${record.doubtsSolvedCount}</td>
              <td><span class="verdict-pill ${recommendationClass(record.recommendation)}">${escapeHtml(record.recommendation)}</span></td>
              <td><div class="reason-copy">${escapeHtml(finalReason)}</div></td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="9" class="empty-cell">No students match the current analysis filter.</td></tr>`;

  analysisTableBody.querySelectorAll("[data-student-row]").forEach((row) => {
    row.addEventListener("click", () => {
      selectedStudentUid = row.dataset.studentRow;
      analysisStudentSelect.value = selectedStudentUid;
      renderFocusedStudent();
      renderTopRecommendation();
    });
  });
}

function renderTopRecommendation() {
  const record = filteredRecords[0] || null;
  if (!record) {
    topCandidateScore.textContent = "0";
    topRecommendation.innerHTML = `<div class="empty-state">No recommendation can be generated without student data.</div>`;
    return;
  }

  const aiReason = aiInsights.topCandidateUid === record.uid ? aiInsights.topCandidateReason : "";
  const finalReason = aiReason || record.localReason;
  topCandidateScore.textContent = record.overallScore.toFixed(1);
  topRecommendation.innerHTML = `
    <div class="inline-student">
      ${renderAvatar(record.photoURL, record.name, 52)}
      <div class="inline-student-meta">
        <strong>${escapeHtml(record.name)}</strong>
        <span>${escapeHtml(record.group)} · ${escapeHtml(record.recommendation)}</span>
      </div>
    </div>
    <div class="hero-title" style="margin-top:18px">${escapeHtml(record.name)}</div>
    <div class="hero-subtitle">${escapeHtml(finalReason)}</div>
    <div class="hero-list">
      ${record.strengths.slice(0, 3).map((strength) => `<div class="hero-list-item">${escapeHtml(strength)}</div>`).join("")}
    </div>
    ${record.concerns.length ? `<div class="risk-list">${record.concerns.slice(0, 2).map((risk) => `<div class="risk-item">${escapeHtml(risk)}</div>`).join("")}</div>` : ""}
  `;
}

function renderFocusedStudent() {
  const record = getSelectedRecord();
  if (!record) {
    focusedStudentBadge.textContent = "No student";
    studentDetail.innerHTML = `<div class="empty-state">Choose a student to inspect the detailed analysis.</div>`;
    return;
  }

  focusedStudentBadge.textContent = record.name;
  const aiReason = aiInsights.studentReasons.get(record.uid) || "";
  const finalReason = aiReason || record.localReason;
  const metrics = [
    { label: "Deliverables", value: record.deliverableScore, text: `${record.deliverablesCount} submitted` },
    { label: "Meetings", value: record.meetingScore, text: record.attendanceMarkedCount ? `${record.meetingsAttended} attended` : "Awaiting attendance marking" },
    { label: "Collaboration", value: record.collaborationScore, text: `${record.doubtsSolvedCount} doubts cleared` },
    { label: "Consistency", value: record.consistencyScore, text: `${record.weeksActive} active weeks` },
    { label: "Profile", value: record.profileScore, text: `${record.profileStrengthCount}/4 profile signals` },
    { label: "Risk Penalty", value: record.riskPenalty, text: `${record.openAssignmentIssues + record.openMeetingIssues + record.openWebsiteIssues} active issues`, tone: "risk" },
  ];

  studentDetail.innerHTML = `
    <div class="inline-student">
      ${renderAvatar(record.photoURL, record.name, 56)}
      <div class="inline-student-meta">
        <strong>${escapeHtml(record.name)}</strong>
        <span>${escapeHtml(record.group)} · ${escapeHtml(record.email)}</span>
      </div>
    </div>
    <div class="hero-subtitle" style="margin-top:16px">${escapeHtml(finalReason)}</div>
    <div class="metric-stack">
      ${metrics
        .map(
          (metric) => `
            <div class="metric-row">
              <div class="metric-label">${escapeHtml(metric.label)}</div>
              <div class="chart-track">
                <div class="chart-fill ${metric.tone === "risk" ? "risk" : "metric"}" style="width:${clamp(metric.value)}%"></div>
              </div>
              <div class="metric-value">${escapeHtml(metric.text)}</div>
            </div>
          `,
        )
        .join("")}
    </div>
    <div class="data-grid">
      <div class="data-card">
        <div class="data-card-label">Meetings</div>
        <div class="data-card-value">${record.attendanceMarkedCount ? `${record.meetingScore.toFixed(0)}%` : "Pending"}</div>
      </div>
      <div class="data-card">
        <div class="data-card-label">Credits</div>
        <div class="data-card-value">${record.credits}</div>
      </div>
      <div class="data-card">
        <div class="data-card-label">Recent Deliveries</div>
        <div class="data-card-value">${record.recentDeliverablesCount}</div>
      </div>
      <div class="data-card">
        <div class="data-card-label">Last Activity</div>
        <div class="data-card-value" style="font-size:15px">${escapeHtml(record.latestActivityAt ? humanTime(record.latestActivityAt) : "No activity")}</div>
      </div>
    </div>
    <div class="hero-list">
      ${record.strengths.map((strength) => `<div class="hero-list-item">${escapeHtml(strength)}</div>`).join("")}
    </div>
    ${record.concerns.length ? `<div class="risk-list">${record.concerns.map((risk) => `<div class="risk-item">${escapeHtml(risk)}</div>`).join("")}</div>` : ""}
  `;
}

function renderAttendanceManager() {
  const sortedMeetings = [...meetings].sort((left, right) => toTime(left.meetingAt) - toTime(right.meetingAt));
  if (!sortedMeetings.length) {
    attendanceMeetingSelect.innerHTML = `<option value="">No meetings available</option>`;
    attendanceCoverageBadge.textContent = "Not Marked";
    attendanceList.innerHTML = `<div class="empty-state">Schedule meetings first. Attendance controls appear here for recruiters only.</div>`;
    return;
  }

  if (!selectedMeetingId || !sortedMeetings.some((meeting) => meeting.id === selectedMeetingId)) {
    selectedMeetingId = sortedMeetings[0].id;
  }

  attendanceMeetingSelect.innerHTML = sortedMeetings
    .map(
      (meeting) => `<option value="${escapeHtml(meeting.id)}">${escapeHtml(meeting.title || "Untitled meeting")} · ${escapeHtml(formatDateTime(meeting.meetingAt))}</option>`,
    )
    .join("");
  attendanceMeetingSelect.value = selectedMeetingId;

  const targetMeeting = sortedMeetings.find((meeting) => meeting.id === selectedMeetingId) || sortedMeetings[0];
  const relevantRecords = filteredRecords;
  const markedForMeeting = attendanceRecords.filter((item) => item.meetingId === targetMeeting.id && item.status && item.status !== "unmarked");
  const coverage = relevantRecords.length ? Math.round((markedForMeeting.length / relevantRecords.length) * 100) : 0;
  attendanceCoverageBadge.textContent = `${coverage}% marked`;

  attendanceList.innerHTML = relevantRecords.length
    ? relevantRecords
        .map((record) => {
          const saved = attendanceRecords.find((item) => item.meetingId === targetMeeting.id && item.studentUid === record.uid) || {};
          return `
            <div class="attendance-row">
              <div>
                <div class="inline-student">
                  ${renderAvatar(record.photoURL, record.name, 30)}
                  <div class="inline-student-meta">
                    <strong>${escapeHtml(record.name)}</strong>
                    <span>${escapeHtml(record.group)}</span>
                  </div>
                </div>
                <div class="attendance-helper">Current: ${escapeHtml(saved.status || "unmarked")}${saved.note ? ` · ${escapeHtml(saved.note)}` : ""}</div>
              </div>
              <select class="control-select attendance-status" data-uid="${escapeHtml(record.uid)}">
                <option value="unmarked" ${saved.status === "unmarked" || !saved.status ? "selected" : ""}>Unmarked</option>
                <option value="attended" ${saved.status === "attended" ? "selected" : ""}>Attended</option>
                <option value="excused" ${saved.status === "excused" ? "selected" : ""}>Excused</option>
                <option value="absent" ${saved.status === "absent" ? "selected" : ""}>Absent</option>
              </select>
              <input class="control-input attendance-note" data-uid="${escapeHtml(record.uid)}" type="text" placeholder="Optional note" value="${escapeHtml(saved.note || "")}" />
              <button class="btn btn-secondary btn-compact attendance-save" type="button" data-uid="${escapeHtml(record.uid)}">Save</button>
            </div>
          `;
        })
        .join("")
    : `<div class="empty-state">No students are available in this filter.</div>`;

  attendanceList.querySelectorAll(".attendance-save").forEach((button) => {
    button.addEventListener("click", () => saveAttendance(button.dataset.uid));
  });
}

async function saveAttendance(studentUid) {
  const status = attendanceList.querySelector(`.attendance-status[data-uid="${studentUid}"]`)?.value || "unmarked";
  const note = attendanceList.querySelector(`.attendance-note[data-uid="${studentUid}"]`)?.value.trim() || "";
  const student = analysisRecords.find((record) => record.uid === studentUid);
  const meeting = meetings.find((item) => item.id === selectedMeetingId);

  if (!student || !meeting) {
    toast("Select a valid meeting and student before saving attendance.", "error");
    return;
  }

  try {
    await setDoc(doc(db, "meetingAttendance", getAttendanceDocId(meeting.id, student.uid)), {
      meetingId: meeting.id,
      meetingTitle: meeting.title || "Untitled meeting",
      meetingAt: meeting.meetingAt || null,
      studentUid: student.uid,
      studentName: student.name,
      studentGroup: student.group,
      status,
      note,
      updatedAt: serverTimestamp(),
      markedByUid: currentUser.uid,
      markedByName: currentProfile.name,
    }, { merge: true });
    toast("Attendance saved.", "success");
  } catch (error) {
    toast(`Attendance save failed: ${error.message}`, "error");
  }
}

function buildFallbackAiInsights() {
  const topRecord = filteredRecords[0] || null;
  const strongestGroup = groupSummaries[0] || null;
  return {
    status: "local",
    cohortSummary: topRecord
      ? `${topRecord.name} currently leads the filtered cohort because delivery volume, collaboration, and meeting reliability together produce the highest weighted score.`
      : "No cohort summary is available yet.",
    topCandidateUid: topRecord?.uid || "",
    topCandidateReason: topRecord?.localReason || "",
    groupInsights: strongestGroup
      ? [{ group: strongestGroup.group, insight: `${strongestGroup.group} currently has the strongest average score at ${strongestGroup.avgScore.toFixed(1)}.` }]
      : [],
    studentReasons: new Map(filteredRecords.map((record) => [record.uid, record.localReason])),
    selectionCaveat: meetings.length
      ? "Attendance coverage should stay updated for the strongest recommendation accuracy."
      : "Meeting attendance is neutral until meetings are scheduled.",
    updatedAt: Date.now(),
  };
}

function extractJsonObject(text) {
  const trimmed = String(text || "").trim().replace(/^```json/i, "").replace(/^```/i, "").replace(/```$/i, "").trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("AI response did not include valid JSON.");
  }
  return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
}

async function refreshAiInsights(options = {}) {
  const { manual = false } = options;
  if (!filteredRecords.length) {
    aiInsights = buildFallbackAiInsights();
    renderAiInsights();
    return;
  }

  if (aiRequestInFlight) {
    aiDirty = true;
    return;
  }

  aiRequestInFlight = true;
  aiStatusBadge.textContent = manual ? "Refreshing" : "Updating";
  aiInsightsBox.classList.add("analysis-loading");
  refreshAiButton.disabled = true;

  try {
    const focused = getSelectedRecord();
    const payload = {
      generatedAt: new Date().toISOString(),
      weights: scoreWeights,
      meetingsScheduled: meetings.length,
      filteredGroup: analysisGroupFilter.value,
      totalStudents: filteredRecords.length,
      topCandidates: filteredRecords.slice(0, 8).map((record) => ({
        uid: record.uid,
        name: record.name,
        group: record.group,
        overallScore: Number(record.overallScore.toFixed(2)),
        deliverablesCount: record.deliverablesCount,
        meetingScore: Number(record.meetingScore.toFixed(2)),
        doubtsSolvedCount: record.doubtsSolvedCount,
        credits: record.credits,
        recommendation: record.recommendation,
        localReason: record.localReason,
        openAssignmentIssues: record.openAssignmentIssues,
        openMeetingIssues: record.openMeetingIssues,
      })),
      focusedStudent: focused
        ? {
            uid: focused.uid,
            name: focused.name,
            group: focused.group,
            overallScore: Number(focused.overallScore.toFixed(2)),
            deliverablesCount: focused.deliverablesCount,
            meetingScore: Number(focused.meetingScore.toFixed(2)),
            doubtsSolvedCount: focused.doubtsSolvedCount,
            recommendation: focused.recommendation,
            localReason: focused.localReason,
          }
        : null,
      groupSummary: groupSummaries.map((group) => ({
        group: group.group,
        avgScore: Number(group.avgScore.toFixed(2)),
        avgDeliverables: Number(group.avgDeliverables.toFixed(2)),
        avgAttendance: Number(group.avgAttendance.toFixed(2)),
        avgDoubtsSolved: Number(group.avgDoubtsSolved.toFixed(2)),
        topCandidateName: group.topCandidate?.name || "",
      })),
    };

    const response = await fetch("/api/groq-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "recruiter_analysis",
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "user",
            content: `Return valid JSON only.\nSchema:\n{\n  "cohortSummary": "string",\n  "topCandidateUid": "string",\n  "topCandidateReason": "string",\n  "groupInsights": [{"group": "string", "insight": "string"}],\n  "studentReasons": [{"uid": "string", "reason": "string"}],\n  "selectionCaveat": "string"\n}\nRules:\n- Use only the supplied metrics.\n- Do not invent data.\n- Keep every student reason under 40 words.\n- If evidence is incomplete, say so clearly.\nDataset:\n${JSON.stringify(payload)}`,
          },
        ],
      }),
    });

    const apiPayload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(apiPayload.error || "AI analysis request failed.");
    }

    const parsed = extractJsonObject(apiPayload.reply || "");
    aiInsights = {
      status: "live",
      cohortSummary: parsed.cohortSummary || "",
      topCandidateUid: parsed.topCandidateUid || "",
      topCandidateReason: parsed.topCandidateReason || "",
      groupInsights: Array.isArray(parsed.groupInsights) ? parsed.groupInsights : [],
      studentReasons: new Map(Array.isArray(parsed.studentReasons) ? parsed.studentReasons
        .filter((item) => item && item.uid && item.reason)
        .map((item) => [item.uid, item.reason]) : []),
      selectionCaveat: parsed.selectionCaveat || "",
      updatedAt: Date.now(),
    };
  } catch (error) {
    aiInsights = {
      ...buildFallbackAiInsights(),
      status: "local",
    };
    if (manual) {
      toast(`AI analysis fallback applied: ${error.message}`, "error");
    }
  } finally {
    aiRequestInFlight = false;
    aiInsightsBox.classList.remove("analysis-loading");
    refreshAiButton.disabled = false;
    renderTopRecommendation();
    renderFocusedStudent();
    renderTable();
    renderAiInsights();

    if (aiDirty) {
      aiDirty = false;
      scheduleAiRefresh();
    }
  }
}

function scheduleAiRefresh() {
  window.clearTimeout(aiRefreshTimer);
  aiRefreshTimer = window.setTimeout(() => {
    refreshAiInsights({ manual: false });
  }, 900);
}

function renderAiInsights() {
  const fallback = buildFallbackAiInsights();
  const currentInsights = aiInsights.cohortSummary ? aiInsights : fallback;

  aiStatusBadge.textContent = currentInsights.status === "live" ? "Groq Live" : "Local Fallback";
  aiInsightsBox.innerHTML = `
    <div class="insight-item">
      <div class="insight-label">Cohort Summary</div>
      <div class="analysis-note">${escapeHtml(currentInsights.cohortSummary || fallback.cohortSummary)}</div>
    </div>
    ${currentInsights.groupInsights.length
      ? currentInsights.groupInsights
          .map(
            (item) => `
              <div class="insight-item">
                <div class="insight-label">${escapeHtml(item.group || "Group Insight")}</div>
                <div class="analysis-note">${escapeHtml(item.insight || "")}</div>
              </div>
            `,
          )
          .join("")
      : `<div class="insight-item"><div class="analysis-note">Group insights will become richer as more student data is recorded.</div></div>`}
    <div class="insight-item">
      <div class="insight-label">Recruiter Caveat</div>
      <div class="analysis-note">${escapeHtml(currentInsights.selectionCaveat || fallback.selectionCaveat)}</div>
    </div>
    <div class="insight-item">
      <div class="insight-label">Updated</div>
      <div class="analysis-note">${escapeHtml(currentInsights.updatedAt ? humanTime(currentInsights.updatedAt) : "Waiting for first pass")}</div>
    </div>
  `;
}

function exportCurrentView() {
  if (!filteredRecords.length) {
    toast("No analysis rows are available to export.", "error");
    return;
  }

  const rows = filteredRecords.map((record) => ({
    Rank: record.filteredRank,
    Name: record.name,
    Group: record.group,
    Email: record.email,
    OverallScore: record.overallScore.toFixed(2),
    Recommendation: record.recommendation,
    DeliverablesSubmitted: record.deliverablesCount,
    RecentDeliverables: record.recentDeliverablesCount,
    MeetingsAttended: record.meetingsAttended,
    MeetingsExcused: record.meetingsExcused,
    MeetingsAbsent: record.meetingsAbsent,
    MeetingReliability: record.attendanceMarkedCount ? record.meetingScore.toFixed(2) : "Pending",
    DoubtsCleared: record.doubtsSolvedCount,
    DoubtsAsked: record.doubtsAskedCount,
    Credits: record.credits,
    SelectionReason: aiInsights.studentReasons.get(record.uid) || record.localReason,
  }));

  downloadCsv("analysis-current-view.csv", rows);
  toast("Current analysis view downloaded.", "success");
}

function exportSelectedStudentAnalysis() {
  const selected = getSelectedRecord();
  if (!selected) {
    toast("Choose a student first.", "error");
    return;
  }

  downloadCsv(`${selected.name.replaceAll(" ", "-").toLowerCase()}-analysis.csv`, [{
    Name: selected.name,
    Group: selected.group,
    Email: selected.email,
    OverallScore: selected.overallScore.toFixed(2),
    Recommendation: selected.recommendation,
    DeliverablesSubmitted: selected.deliverablesCount,
    RecentDeliverables: selected.recentDeliverablesCount,
    MeetingsAttended: selected.meetingsAttended,
    MeetingsExcused: selected.meetingsExcused,
    MeetingsAbsent: selected.meetingsAbsent,
    MeetingReliability: selected.attendanceMarkedCount ? selected.meetingScore.toFixed(2) : "Pending",
    DoubtsCleared: selected.doubtsSolvedCount,
    DoubtsAsked: selected.doubtsAskedCount,
    Credits: selected.credits,
    Strengths: selected.strengths.join(" | "),
    Concerns: selected.concerns.join(" | "),
    SelectionReason: aiInsights.studentReasons.get(selected.uid) || selected.localReason,
  }]);
  toast("Focused student analysis downloaded.", "success");
}

function exportSelectionReport() {
  if (!analysisRecords.length) {
    toast("There is no analysis report to export yet.", "error");
    return;
  }

  const rows = analysisRecords.map((record) => ({
    Rank: record.rank,
    Name: record.name,
    Group: record.group,
    OverallScore: record.overallScore.toFixed(2),
    Recommendation: record.recommendation,
    RecruitNow: record.recommendation === "Recommended for full-time" ? "Yes" : "No",
    DeliverablesScore: record.deliverableScore.toFixed(2),
    MeetingScore: record.meetingScore.toFixed(2),
    CollaborationScore: record.collaborationScore.toFixed(2),
    ConsistencyScore: record.consistencyScore.toFixed(2),
    ProfileScore: record.profileScore.toFixed(2),
    RiskPenalty: record.riskPenalty.toFixed(2),
    Reason: aiInsights.studentReasons.get(record.uid) || record.localReason,
    RecruiterCaveat: aiInsights.selectionCaveat || "",
  }));

  downloadCsv("selection-report.csv", rows);
  toast("Selection report downloaded.", "success");
}

function recomputeAndRender() {
  computeAnalysis();
  updateFilterOptions();
  getFilteredRecords();
  renderSummaryCards();
  renderLeaderboard();
  renderGroupChart();
  renderTopRecommendation();
  renderFocusedStudent();
  renderTable();
  renderAttendanceManager();
  analysisStateBadge.textContent = `${filteredRecords.length} live`;
  analysisUpdatedAt.textContent = humanTime(Date.now());
  scheduleAiRefresh();
}

function wireStaticEvents() {
  document.getElementById("logout-btn").addEventListener("click", async () => {
    await signOutUser();
    window.location.replace("index.html");
  });
  document.getElementById("mobile-logout").addEventListener("click", async () => {
    await signOutUser();
    window.location.replace("index.html");
  });
  document.getElementById("hamburger").addEventListener("click", () => document.getElementById("mobile-menu").classList.toggle("open"));

  analysisGroupFilter.addEventListener("change", () => {
    updateFilterOptions();
    getFilteredRecords();
    renderSummaryCards();
    renderLeaderboard();
    renderGroupChart();
    renderTopRecommendation();
    renderFocusedStudent();
    renderTable();
    renderAttendanceManager();
    scheduleAiRefresh();
  });

  analysisSort.addEventListener("change", () => {
    getFilteredRecords();
    updateFilterOptions();
    renderSummaryCards();
    renderLeaderboard();
    renderGroupChart();
    renderTopRecommendation();
    renderFocusedStudent();
    renderTable();
    renderAttendanceManager();
    scheduleAiRefresh();
  });

  analysisStudentSelect.addEventListener("change", () => {
    selectedStudentUid = analysisStudentSelect.value || "";
    renderFocusedStudent();
    scheduleAiRefresh();
  });

  attendanceMeetingSelect.addEventListener("change", () => {
    selectedMeetingId = attendanceMeetingSelect.value;
    renderAttendanceManager();
  });

  refreshAiButton.addEventListener("click", () => refreshAiInsights({ manual: true }));
  exportCurrentButton.addEventListener("click", exportCurrentView);
  exportSelectedButton.addEventListener("click", exportSelectedStudentAnalysis);
  exportSelectionReportButton.addEventListener("click", exportSelectionReport);
}

async function init() {
  const session = await requireAuth({ roles: [ROLE_RECRUITER], profileRedirect: "index.html", redirectTo: "index.html" });
  if (!session) {
    return;
  }

  currentUser = session.user;
  currentProfile = session.profile;
  updateUserCard();
  wireStaticEvents();
  document.body.classList.add("page-ready");
  touchLastLogin(currentUser.uid);

  listenToCollection("interns", (items) => {
    interns = sortByName(items.filter((item) => item.role === ROLE_INTERN));
    recomputeAndRender();
  }, { profileMode: true });

  listenToCollection("meetings", (items) => {
    meetings = items;
    recomputeAndRender();
  });

  listenToCollection("deliverables", (items) => {
    deliverables = items;
    recomputeAndRender();
  });

  listenToCollection("qa", (items) => {
    qaItems = items.map((item) => ({ solved: false, ...item }));
    recomputeAndRender();
  });

  listenToCollection("tickets", (items) => {
    tickets = items.map((item) => ({ status: "open", ...item }));
    recomputeAndRender();
  });

  listenToCollection("meetingAttendance", (items) => {
    attendanceRecords = items;
    recomputeAndRender();
  });
}

init();
