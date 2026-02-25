// Constants & State
const SUBJECT_COLORS = {
    'Physics': 'var(--color-physics)',
    'Chemistry': 'var(--color-chemistry)',
    'Maths': 'var(--color-maths)',
    'Computer': 'var(--color-computer)',
    'English': 'var(--color-english)',
    'Nepali': 'var(--color-nepali)'
};

let studySessions = JSON.parse(localStorage.getItem('studySessions')) || [];
let timeLogs = JSON.parse(localStorage.getItem('timeLogs')) || [];
let aiRatingsHistory = JSON.parse(localStorage.getItem('aiRatingsHistory')) || [];

// Immediately seed IndexedDB mirror from localStorage if data exists
// (ensures IndexedDB always has a copy even if it was never mirrored before)
if (studySessions.length > 0 || timeLogs.length > 0) {
    setTimeout(() => {
        idb.set('studySessions', studySessions).catch(() => { });
        idb.set('timeLogs', timeLogs).catch(() => { });
    }, 500);
}
let currentFilter = 'all';
let currentTableSubject = 'Physics';

// Auto Backup State
let backupDirHandle = null;
let timeLogBackupFolderHandle = null;

// Lightweight IndexedDB wrapper for persisting the backup directory handles
const idb = {
    async getDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('StudyTrackerDB', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('store');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },
    async get(key) {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('store', 'readonly');
            const req = tx.objectStore('store').get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    async set(key, val) {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('store', 'readwrite');
            const req = tx.objectStore('store').put(val, key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    },
    async delete(key) {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('store', 'readwrite');
            const req = tx.objectStore('store').delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }
};

// DOM Elements - Navigation & Views
const navBtns = document.querySelectorAll('.nav-btn');
const viewSections = document.querySelectorAll('.view-section');

// DOM Elements - Dashboard
const addSessionForm = document.getElementById('addSessionForm');
const todayRevisionList = document.getElementById('todayRevisionList');
const allTopicsList = document.getElementById('allTopicsList');
const dateReadInput = document.getElementById('dateRead');
const currentDateDisplay = document.getElementById('currentDateDisplay');
const filterBtns = document.querySelectorAll('.filter-btn');
const revisionTableBody = document.getElementById('revisionTableBody');

// ==========================================
// TIME TRACKER LOGIC
// ==========================================

const addTimeLogForm = document.getElementById('addTimeLogForm');
const timeLogFeed = document.getElementById('timeLogFeed');
const totalHoursTodayEl = document.getElementById('totalHoursToday');
const historyDateFilter = document.getElementById('historyDateFilter');

historyDateFilter.addEventListener('change', renderTimeLogs);

addTimeLogForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const taskName = document.getElementById('timeTaskInput').value.trim();
    const subject = document.getElementById('timeSubjectInput').value;
    const startTimeStr = document.getElementById('timeStartInput').value;
    const endTimeStr = document.getElementById('timeEndInput').value;
    const dateStr = document.getElementById('timeDateInput').value;
    const notes = document.getElementById('timeNotesInput').value.trim();

    if (!taskName || !startTimeStr || !endTimeStr || !dateStr || !notes) return;

    // Parse start/end times
    const start = new Date(`2000-01-01T${startTimeStr}`);
    let end = new Date(`2000-01-01T${endTimeStr}`);

    // Detect overnight shift (end time is earlier than start time)
    const isOvernight = end <= start;

    if (isOvernight) {
        // SPLIT at midnight into two separate log entries
        // Part 1: original date, startTime → 23:59 (before midnight)
        const midnightMs = new Date('2000-01-02T00:00').getTime() - start.getTime();
        const beforeMidnightHours = parseFloat((midnightMs / (1000 * 60 * 60)).toFixed(2));

        // Part 2: next date, 00:00 → endTime (after midnight)
        const afterMidnightMs = end.getTime() - new Date('2000-01-01T00:00').getTime();
        const afterMidnightHours = parseFloat((afterMidnightMs / (1000 * 60 * 60)).toFixed(2));

        // Calculate next day's date string (avoid toISOString timezone trap)
        const nextDay = new Date(dateStr + 'T12:00:00'); // noon avoids DST edge cases
        nextDay.setDate(nextDay.getDate() + 1);
        const nextDayStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`;

        const now = new Date().toISOString();

        // Log 1: Before midnight (original date)
        if (beforeMidnightHours > 0) {
            timeLogs.unshift({
                id: Date.now().toString(),
                task: taskName,
                subject: subject || '',
                startTime: startTimeStr,
                endTime: '23:59',
                date: dateStr,
                duration: beforeMidnightHours,
                notes: notes,
                createdAt: now
            });
        }

        // Log 2: After midnight (next date)
        if (afterMidnightHours > 0) {
            timeLogs.unshift({
                id: (Date.now() + 1).toString(),
                task: taskName,
                subject: subject || '',
                startTime: '00:00',
                endTime: endTimeStr,
                date: nextDayStr,
                duration: afterMidnightHours,
                notes: notes + ' (continued from previous night)',
                createdAt: now
            });
        }
    } else {
        // Normal same-day entry
        const durationMs = end - start;
        const durationHours = (durationMs / (1000 * 60 * 60)).toFixed(2);

        timeLogs.unshift({
            id: Date.now().toString(),
            task: taskName,
            subject: subject || '',
            startTime: startTimeStr,
            endTime: endTimeStr,
            date: dateStr,
            duration: parseFloat(durationHours),
            notes: notes,
            createdAt: new Date().toISOString()
        });
    }

    saveToLocalStorage();
    renderTimeLogs();

    // Auto-backup trigger
    autoBackupSync();

    addTimeLogForm.reset();
    document.getElementById('timeDateInput').value = new Date().toISOString().split('T')[0];
    // Reset textarea height after clearing
    const notesEl = document.getElementById('timeNotesInput');
    notesEl.style.height = 'auto';
});

// Enter to submit log, Shift+Enter for new line
document.getElementById('timeNotesInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        document.getElementById('addTimeLogForm').requestSubmit();
    }
});

// Auto-resize textarea for short notes
document.getElementById('timeNotesInput').addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = this.scrollHeight + 'px';
});

function renderTimeLogs() {
    timeLogFeed.innerHTML = '';
    const filterDate = historyDateFilter.value;

    let dailyTotal = 0;

    const filteredLogs = timeLogs.filter(log => log.date === filterDate);

    if (filteredLogs.length === 0) {
        timeLogFeed.innerHTML = `
            <div style="text-align: center; color: var(--text-secondary); padding: 2rem;">
                <i class="fa-solid fa-mug-hot" style="font-size: 2rem; margin-bottom: 1rem; opacity: 0.5;"></i><br>
                No activities logged for this date.
            </div>
        `;
    }

    filteredLogs.forEach(log => {
        dailyTotal += log.duration;

        // format to 12-hour AM/PM purely for display
        const formatTime = (timeStr) => {
            const [h, m] = timeStr.split(':');
            let hour = parseInt(h);
            const ampm = hour >= 12 ? 'PM' : 'AM';
            hour = hour % 12 || 12;
            return `${hour}:${m} ${ampm}`;
        };

        const item = document.createElement('div');
        item.className = 'time-log-card animated-entry';

        let notesHtml = '';
        if (log.notes) {
            notesHtml = `<div class="tl-notes"><i class="fa-solid fa-quote-left" style="opacity:0.5; margin-right:5px;"></i> ${log.notes}</div>`;
        }
        let actionBtnsHtml = '';
        if (log.createdAt) {
            const diffMins = (Date.now() - new Date(log.createdAt).getTime()) / (1000 * 60);
            if (diffMins <= 5) {
                actionBtnsHtml = `
                    <div class="tl-action-btns" style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
                        <button class="btn-edit" title="Edit this log" onclick="editTimeLog('${log.id}')" style="font-size: 0.8rem; padding: 0.3rem 0.6rem;"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
                        <button class="btn-delete" title="Undo Log (Valid for 5 mins)" onclick="deleteTimeLog('${log.id}')" style="font-size: 0.8rem; padding: 0.3rem 0.6rem;"><i class="fa-solid fa-trash-can"></i> Delete</button>
                    </div>`;
            }
        }

        const subjectBadge = log.subject ? `<span style="display: inline-block; background: rgba(99,102,241,0.15); color: #a5b4fc; padding: 0.15rem 0.5rem; border-radius: 1rem; font-size: 0.75rem; font-weight: 500; margin-left: 0.5rem;">${log.subject}</span>` : '';

        item.innerHTML = `
            <div>
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div class="tl-task">${log.task}${subjectBadge}</div>
                </div>
                <div class="tl-time-window"><i class="fa-regular fa-clock"></i> ${formatTime(log.startTime)} - ${formatTime(log.endTime)}</div>
                ${notesHtml}
                ${actionBtnsHtml}
            </div>
            <div class="tl-duration">
                ${log.duration} <span>hrs</span>
            </div>
        `;
        timeLogFeed.appendChild(item);
    });

    totalHoursTodayEl.textContent = dailyTotal.toFixed(1);
}

// View & Table DOM
// const navBtns = document.querySelectorAll('.nav-btn'); // Moved above
// const viewSections = document.querySelectorAll('.view-section'); // Moved above
const subTabs = document.querySelectorAll('.sub-tab');
// const revisionTableBody = document.getElementById('revisionTableBody'); // Moved above

// ==========================================
// TOAST NOTIFICATION UTILITY
// ==========================================
function showToast(message, type = 'info') {
    const existing = document.querySelector('.st-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'st-toast';
    const colors = {
        success: { bg: 'rgba(16, 185, 129, 0.95)', icon: 'fa-circle-check' },
        error: { bg: 'rgba(239, 68, 68, 0.95)', icon: 'fa-circle-xmark' },
        warning: { bg: 'rgba(245, 158, 11, 0.95)', icon: 'fa-triangle-exclamation' },
        info: { bg: 'rgba(99, 102, 241, 0.95)', icon: 'fa-circle-info' }
    };
    const c = colors[type] || colors.info;
    toast.style.cssText = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        background: ${c.bg}; color: #fff; padding: 0.75rem 1.5rem;
        border-radius: 12px; font-size: 0.9rem; font-family: 'Outfit', sans-serif;
        z-index: 99999; display: flex; align-items: center; gap: 0.5rem;
        box-shadow: 0 8px 32px rgba(0,0,0,0.3); backdrop-filter: blur(10px);
        animation: toastIn 0.4s ease;
    `;
    toast.innerHTML = `<i class="fa-solid ${c.icon}"></i> ${message}`;
    document.body.appendChild(toast);

    // Add animation keyframes if not present
    if (!document.getElementById('toastAnimStyle')) {
        const style = document.createElement('style');
        style.id = 'toastAnimStyle';
        style.textContent = `
            @keyframes toastIn { from { opacity: 0; transform: translateX(-50%) translateY(-20px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
            @keyframes toastOut { from { opacity: 1; transform: translateX(-50%) translateY(0); } to { opacity: 0; transform: translateX(-50%) translateY(-20px); } }
        `;
        document.head.appendChild(style);
    }

    setTimeout(() => {
        toast.style.animation = 'toastOut 0.4s ease forwards';
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

// ==========================================
// DATA RECOVERY ENGINE
// ==========================================
async function recoverDataIfNeeded() {
    // If localStorage already has data, no recovery needed
    const lsSessions = localStorage.getItem('studySessions');
    const lsTimeLogs = localStorage.getItem('timeLogs');
    const hasLocalSessions = lsSessions && JSON.parse(lsSessions).length > 0;
    const hasLocalTimeLogs = lsTimeLogs && JSON.parse(lsTimeLogs).length > 0;

    if (hasLocalSessions || hasLocalTimeLogs) return false;

    console.warn('⚠️ localStorage is empty! Attempting data recovery...');

    // LAYER 1: Try IndexedDB mirror
    try {
        const idbSessions = await idb.get('studySessions');
        const idbTimeLogs = await idb.get('timeLogs');
        if ((idbSessions && idbSessions.length > 0) || (idbTimeLogs && idbTimeLogs.length > 0)) {
            studySessions = idbSessions || [];
            timeLogs = idbTimeLogs || [];
            localStorage.setItem('studySessions', JSON.stringify(studySessions));
            localStorage.setItem('timeLogs', JSON.stringify(timeLogs));
            console.log('✅ Data recovered from IndexedDB mirror');
            return 'indexeddb';
        }
    } catch (e) {
        console.warn('IndexedDB recovery failed:', e);
    }

    // LAYER 2: Try auto-backup file from linked folder
    try {
        if (backupDirHandle) {
            // Try to get permission silently
            const hasPermission = await verifyPermission(backupDirHandle, false);
            if (hasPermission) {
                const fileHandle = await backupDirHandle.getFileHandle('StudyTracker_AutoBackup.backup');
                const file = await fileHandle.getFile();
                const content = await file.text();
                let decoded;
                if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
                    decoded = JSON.parse(content);
                } else {
                    decoded = JSON.parse(atob(content));
                }
                if (decoded.studySessions || decoded.timeLogs) {
                    studySessions = decoded.studySessions || [];
                    timeLogs = decoded.timeLogs || [];
                    localStorage.setItem('studySessions', JSON.stringify(studySessions));
                    localStorage.setItem('timeLogs', JSON.stringify(timeLogs));
                    // Also re-seed IndexedDB
                    idb.set('studySessions', studySessions).catch(() => { });
                    idb.set('timeLogs', timeLogs).catch(() => { });
                    console.log('✅ Data recovered from auto-backup file');
                    return 'backup-file';
                }
            }
        }
    } catch (e) {
        console.warn('Auto-backup file recovery failed:', e);
    }

    return false;
}

// Initialize App
async function init() {
    // CRITICAL: Restore backup handle FIRST so recovery can use it
    await restoreAutoBackupSettings();

    // Run data recovery before anything else renders
    const recovered = await recoverDataIfNeeded();
    if (recovered === 'indexeddb') {
        showToast('Data recovered automatically from backup! 🔄', 'success');
    } else if (recovered === 'backup-file') {
        showToast('Data recovered from your linked backup folder! 📂', 'success');
    }

    // Set today's date in form by default
    const today = new Date().toISOString().split('T')[0];
    dateReadInput.value = today;

    // Display current date in header gracefully
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    currentDateDisplay.textContent = new Date().toLocaleDateString('en-US', options);

    // Start 1-minute interval to refresh UI (specifically for 5-min delete window)
    setInterval(() => {
        if (document.getElementById('dashboardView').classList.contains('active')) {
            renderAllTopics();
        } else if (document.getElementById('hourLogView').classList.contains('active')) {
            renderTimeLogs();
        }
    }, 60000);

    // Set default date for Time Tracker to today
    document.getElementById('timeDateInput').value = new Date().toISOString().split('T')[0];
    document.getElementById('historyDateFilter').value = new Date().toISOString().split('T')[0];

    // Initial render
    renderDashboard();
    renderTableView();
    renderTimeLogs();

    // Event Listeners
    addSessionForm.addEventListener('submit', handleAddSession);
}

// Navigation — wired at top level (not inside init) to avoid timing issues
navBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        navBtns.forEach(b => b.classList.remove('active'));
        viewSections.forEach(v => v.classList.remove('active'));
        const targetViewId = btn.getAttribute('data-view');
        btn.classList.add('active');
        document.getElementById(targetViewId).classList.add('active');
        if (targetViewId === 'tableView') {
            renderTableView();
        } else if (targetViewId === 'hourLogView') {
            renderTimeLogs();
        } else {
            renderDashboard();
        }
    });
});
subTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
        subTabs.forEach(t => t.classList.remove('active'));
        e.currentTarget.classList.add('active');
        currentTableSubject = e.currentTarget.dataset.subject;
        renderTableView();
    });
});

// Filter logic
filterBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        filterBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentFilter = e.target.dataset.filter;
        renderAllTopics();
    });
});

// Persist data reliably using localStorage + IndexedDB mirror
function saveToLocalStorage() {
    localStorage.setItem('studySessions', JSON.stringify(studySessions));
    localStorage.setItem('timeLogs', JSON.stringify(timeLogs));
    // REDUNDANT SAVE: Mirror to IndexedDB so data survives localStorage wipes
    idb.set('studySessions', studySessions).catch(e => console.warn('IDB mirror save failed:', e));
    idb.set('timeLogs', timeLogs).catch(e => console.warn('IDB mirror save failed:', e));
}

// Form Submission Handler
function handleAddSession(e) {
    e.preventDefault();

    const subject = document.getElementById('subject').value;
    const topic = document.getElementById('topic').value.trim();
    const dateRead = document.getElementById('dateRead').value;

    if (!subject || !topic || !dateRead) return;

    const newSession = {
        id: Date.now().toString(), // Unique internal ID
        subject,
        topic,
        dateRead, // YYYY-MM-DD
        createdAt: new Date().toISOString(),
        revisions: {
            rev2: { done: false, completedAt: null },
            rev4: { done: false, completedAt: null },
            rev7: { done: false, completedAt: null }
        }
    };

    // Add to the front of our list
    studySessions.unshift(newSession);
    saveToLocalStorage();

    // Reset topic field so user can keep adding
    document.getElementById('topic').value = '';

    // Re-render immediately
    renderDashboard();
    renderTableView();

    // Trigger auto-backup if enabled
    autoBackupSync();
}

// Edit Time Log - Pre-fill form with log data for editing
function editTimeLog(id) {
    const logIndex = timeLogs.findIndex(l => l.id === id);
    if (logIndex === -1) return;

    const log = timeLogs[logIndex];

    // Check 5-minute window
    if (log.createdAt) {
        const diffMins = (Date.now() - new Date(log.createdAt).getTime()) / (1000 * 60);
        if (diffMins > 5) {
            alert("Edit window (5 minutes) has expired for this log.");
            renderTimeLogs();
            return;
        }
    }

    // Pre-fill the form with the log's current data
    document.getElementById('timeTaskInput').value = log.task;
    document.getElementById('timeSubjectInput').value = log.subject || '';
    document.getElementById('timeStartInput').value = log.startTime;
    document.getElementById('timeEndInput').value = log.endTime;
    document.getElementById('timeDateInput').value = log.date;
    const notesTextarea = document.getElementById('timeNotesInput');
    notesTextarea.value = log.notes || '';
    // Trigger auto-resize for textarea
    notesTextarea.style.height = 'auto';
    notesTextarea.style.height = notesTextarea.scrollHeight + 'px';

    // Remove the old log entry
    timeLogs.splice(logIndex, 1);
    saveToLocalStorage();
    renderTimeLogs();
    autoBackupSync();

    // Scroll to the form so user can edit and re-save
    document.getElementById('addTimeLogForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Time Log Deletion Logic (undo window)
function deleteTimeLog(id) {
    const logIndex = timeLogs.findIndex(l => l.id === id);
    if (logIndex === -1) return;

    const log = timeLogs[logIndex];
    if (!log.createdAt) return;

    const diffMins = (Date.now() - new Date(log.createdAt).getTime()) / (1000 * 60);

    if (diffMins <= 5) {
        if (confirm(`Are you sure you want to delete the time log for "${log.task}"?`)) {
            timeLogs.splice(logIndex, 1);
            saveToLocalStorage();
            renderTimeLogs();
            autoBackupSync();
        }
    } else {
        alert("Delete window (5 minutes) has expired for this log. To wipe data completely, import an empty backup file.");
        renderTimeLogs(); // Re-render to clear the button
    }
}

// Session Deletion Logic (undo window)
function deleteSession(id) {
    const sessionIndex = studySessions.findIndex(s => s.id === id);
    if (sessionIndex === -1) return;

    const session = studySessions[sessionIndex];
    if (!session.createdAt) return;

    const diffMins = (Date.now() - new Date(session.createdAt).getTime()) / (1000 * 60);

    if (diffMins <= 5) {
        if (confirm(`Are you sure you want to delete the log for "${session.topic}"?`)) {
            studySessions.splice(sessionIndex, 1);
            saveToLocalStorage();
            renderDashboard();
            renderTableView();
            autoBackupSync();
        }
    } else {
        alert("Delete window (5 minutes) has expired for this log. To wipe data completely, import an empty backup file.");
        renderDashboard(); // Re-render to clear the button
    }
}

/**
 * Calculates strict day differences, dropping time components.
 */
function calculateDaysDifference(dateString1, dateString2) {
    const d1 = new Date(dateString1);
    d1.setHours(0, 0, 0, 0);

    const d2 = new Date(dateString2);
    d2.setHours(0, 0, 0, 0);

    const diffTime = Math.abs(d2 - d1);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Return negative if d1 (read date) is logically ahead of d2 (today),
    // though generally d2 > d1 (read date is in past)
    if (d1 > d2) return -diffDays;
    return diffDays;
}

// 2-4-7 Logic Engine
function getRevisionsDueToday() {
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0); // Normalize today's date to start of day
    const dueToday = [];

    // Helper to calculate days difference between two Date objects
    const getDaysDifference = (date1, date2) => {
        const d1 = new Date(date1);
        d1.setHours(0, 0, 0, 0);
        const d2 = new Date(date2);
        d2.setHours(0, 0, 0, 0);
        const diffTime = Math.abs(d2.getTime() - d1.getTime());
        return Math.round(diffTime / (1000 * 60 * 60 * 24));
    };

    studySessions.forEach(session => {
        // Migrate legacy boolean structure if necessary
        const rev2 = typeof session.revisions.rev2 === 'boolean' ? { done: session.revisions.rev2, completedAt: null } : session.revisions.rev2;
        const rev4 = typeof session.revisions.rev4 === 'boolean' ? { done: session.revisions.rev4, completedAt: null } : session.revisions.rev4;
        const rev7 = typeof session.revisions.rev7 === 'boolean' ? { done: session.revisions.rev7, completedAt: null } : session.revisions.rev7;

        if (rev2.done && rev4.done && rev7.done) return; // All revisions completed

        const baseDate = new Date(session.dateRead);
        baseDate.setHours(0, 0, 0, 0);

        // Determine which revision is next due and calculate its target date
        let targetRevisionType = '';
        let targetRevisionLabel = '';
        let referenceDate = null; // The date from which to count days for the next revision

        if (!rev2.done) {
            targetRevisionType = 'rev2';
            targetRevisionLabel = '2-Day Revision';
            referenceDate = baseDate; // Count 2 days from original read date
            const daysDiff = getDaysDifference(referenceDate, todayDate);
            if (daysDiff >= 2) {
                dueToday.push({ ...session, revisionType: targetRevisionType, revisionLabel: targetRevisionLabel, daysOverdue: daysDiff - 2 });
            }
        } else if (!rev4.done) {
            targetRevisionType = 'rev4';
            targetRevisionLabel = '4-Day Revision';
            // Count 4 days from when rev2 was completed. If no completedAt (legacy), use baseDate + 2 days.
            referenceDate = rev2.completedAt ? new Date(rev2.completedAt) : new Date(baseDate.getTime() + (2 * 24 * 60 * 60 * 1000));
            referenceDate.setHours(0, 0, 0, 0);
            const daysDiff = getDaysDifference(referenceDate, todayDate);
            if (daysDiff >= 4) {
                dueToday.push({ ...session, revisionType: targetRevisionType, revisionLabel: targetRevisionLabel, daysOverdue: daysDiff - 4 });
            }
        } else if (!rev7.done) {
            targetRevisionType = 'rev7';
            targetRevisionLabel = '7-Day Revision';
            // Count 7 days from when rev4 was completed. If no completedAt (legacy), use baseDate + 6 days.
            referenceDate = rev4.completedAt ? new Date(rev4.completedAt) : new Date(baseDate.getTime() + ((2 + 4) * 24 * 60 * 60 * 1000));
            referenceDate.setHours(0, 0, 0, 0);
            const daysDiff = getDaysDifference(referenceDate, todayDate);
            if (daysDiff >= 7) {
                dueToday.push({ ...session, revisionType: targetRevisionType, revisionLabel: targetRevisionLabel, daysOverdue: daysDiff - 7 });
            }
        }
    });

    return dueToday;
}

function renderDashboard() {
    renderTodayRevisions();
    renderAllTopics();
}

// Fired when user clicks 'Mark Completed' on a revision card
function completeRevision(sessionId, revType) {
    const sessionIndex = studySessions.findIndex(s => s.id === sessionId);
    if (sessionIndex === -1) return;

    const session = studySessions[sessionIndex];

    // Ensure session structure is migrated to new format if it's old
    if (typeof session.revisions.rev2 === 'boolean') {
        session.revisions = {
            rev2: { done: session.revisions.rev2, completedAt: null },
            rev4: { done: session.revisions.rev4, completedAt: null },
            rev7: { done: session.revisions.rev7, completedAt: null }
        };
    }

    // Determine which revision to mark complete. Order matters.
    // This function is called with the specific revType that is due.
    // We update that specific revision.
    if (session.revisions[revType] && !session.revisions[revType].done) {
        session.revisions[revType] = { done: true, completedAt: new Date().toISOString() };
    } else {
        // If it's already done or revType is invalid, do nothing.
        return;
    }

    saveToLocalStorage();

    // Re-calculate and animate out
    renderDashboard();
    renderTableView();

    // Trigger auto-backup if enabled
    autoBackupSync();
}

// Inject Today's Cards
function renderTodayRevisions() {
    todayRevisionList.innerHTML = '';
    const dueToday = getRevisionsDueToday();

    if (dueToday.length === 0) {
        todayRevisionList.innerHTML = `
            <div class="empty-state animated-entry">
                <i class="fa-solid fa-mug-hot"></i>
                <p>No 2-4-7 revisions strictly due today. Great job!</p>
            </div>
        `;
        return;
    }

    dueToday.forEach((session, index) => {
        const color = SUBJECT_COLORS[session.subject] || 'var(--accent-primary)';

        const card = document.createElement('div');
        card.className = 'revision-card animated-entry';
        card.style.setProperty('--card-color', color);
        // Staggered animation
        card.style.animationDelay = `${index * 0.1}s`;

        // Visual check for Overdue status
        let overdueBadge = '';
        if (session.daysOverdue > 0) {
            const label = session.daysOverdue === 1 ? 'day' : 'days';
            overdueBadge = `<span style="color: #ef4444; font-size: 0.8rem; font-weight: 600; margin-left: 0.5rem;"><i class="fa-solid fa-circle-exclamation"></i> ${session.daysOverdue} ${label} overdue</span>`;
        }

        card.innerHTML = `
            <div class="card-subject">${session.subject}</div>
            <div class="card-topic">${session.topic}</div>
            <div class="card-meta">
                <span class="revision-badge">${session.revisionLabel}</span>
                ${overdueBadge}
                <span><i class="fa-regular fa-clock"></i> Read: ${session.dateRead}</span>
            </div>
            <button class="btn-complete-revision" onclick="completeRevision('${session.id}', '${session.revisionType}')">
                <i class="fa-solid fa-check"></i> Mark Completed
            </button>
        `;
        todayRevisionList.appendChild(card);
    });
}

// Inject All Topics List View
function renderAllTopics() {
    allTopicsList.innerHTML = '';

    let filteredSessions = studySessions;
    if (currentFilter !== 'all') {
        filteredSessions = studySessions.filter(s => s.subject === currentFilter);
    }

    if (filteredSessions.length === 0) {
        allTopicsList.innerHTML = `
            <div class="empty-state">
                <p>No topics found. Log some sessions first!</p>
            </div>
        `;
        return;
    }

    filteredSessions.forEach((session, index) => {
        const color = SUBJECT_COLORS[session.subject] || 'var(--accent-primary)';
        const item = document.createElement('div');
        item.className = 'topic-item animated-entry';
        item.style.animationDelay = `${index * 0.05}s`;

        // Visual indicators of step completion
        // Graceful legacy migration handled previously but checking just in case
        const rev2Done = session.revisions.rev2.done ?? session.revisions.rev2 === true;
        const rev4Done = session.revisions.rev4.done ?? session.revisions.rev4 === true;
        const rev7Done = session.revisions.rev7.done ?? session.revisions.rev7 === true;

        const rev2Class = rev2Done ? 'completed' : 'pending';
        const rev4Class = rev4Done ? 'completed' : 'pending';
        const rev7Class = rev7Done ? 'completed' : 'pending';

        const rev2Icon = rev2Done ? '<i class="fa-solid fa-check"></i>' : '2d';
        const rev4Icon = rev4Done ? '<i class="fa-solid fa-check"></i>' : '4d';
        const rev7Icon = rev7Done ? '<i class="fa-solid fa-check"></i>' : '7d';

        // 5-minute undo/delete window check
        let deleteBtnHtml = '';
        if (session.createdAt) {
            const diffMins = (Date.now() - new Date(session.createdAt).getTime()) / (1000 * 60);
            if (diffMins <= 5) {
                deleteBtnHtml = `<button class="btn-delete" title="Undo Log (Valid for 5 mins)" onclick="deleteSession('${session.id}')"><i class="fa-solid fa-trash-can"></i> Delete</button>`;
            }
        }

        item.innerHTML = `
            <div class="topic-info-main">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.25rem;">
                    <h4>${session.topic}</h4>
                    ${deleteBtnHtml}
                </div>
                <div class="topic-info-sub">
                    <span>
                        <div class="topic-subject-dot" style="--card-color: ${color}"></div>
                        ${session.subject}
                    </span>
                    <span><i class="fa-regular fa-calendar"></i> ${session.dateRead}</span>
                </div>
            </div>
            <div class="topic-status">
                <div class="status-pills" title="Revision Checkpoints">
                    <div class="status-pill ${rev2Class}" title="2-Day">${rev2Icon}</div>
                    <div class="status-pill ${rev4Class}" title="4-Day">${rev4Icon}</div>
                    <div class="status-pill ${rev7Class}" title="7-Day">${rev7Icon}</div>
                </div>
            </div>
        `;
        allTopicsList.appendChild(item);
    });
}

// Render Excel-like Table View
function renderTableView() {
    revisionTableBody.innerHTML = '';

    // Filter by the currently selected subject tab in the table view
    const filteredSessions = studySessions.filter(s => s.subject === currentTableSubject);

    if (filteredSessions.length === 0) {
        revisionTableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; color: var(--text-secondary); padding: 3rem 1rem;">
                    <i class="fa-solid fa-folder-open" style="font-size: 2rem; margin-bottom: 1rem; opacity: 0.5;"></i><br>
                    No logs found for ${currentTableSubject}. Add a session to see it here.
                </td>
            </tr>
        `;
        return;
    }

    filteredSessions.forEach((session, index) => {
        const tr = document.createElement('tr');
        tr.className = 'animated-entry';
        tr.style.animationDelay = `${index * 0.05}s`;

        // Helper to format the status cells beautifully with date logic
        const getStatusCell = (session, revType) => {
            const revObj = typeof session.revisions[revType] === 'boolean'
                ? { done: session.revisions[revType], completedAt: null }
                : session.revisions[revType];

            if (revObj.done) {
                let dateHtml = '';
                if (revObj.completedAt) {
                    const dateObj = new Date(revObj.completedAt);
                    const shortDate = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                    dateHtml = `<div class="status-date">${shortDate}</div>`;
                }
                return `
                    <div class="status-cell-wrapper">
                        <div class="status-cell done"><i class="fa-solid fa-check"></i></div>
                        ${dateHtml}
                    </div>
                `;
            } else {
                // Calculate pending predictive due date
                const baseDate = new Date(session.dateRead);
                baseDate.setHours(0, 0, 0, 0);
                const rev2 = typeof session.revisions.rev2 === 'boolean' ? { done: session.revisions.rev2, completedAt: null } : session.revisions.rev2;
                const rev4 = typeof session.revisions.rev4 === 'boolean' ? { done: session.revisions.rev4, completedAt: null } : session.revisions.rev4;

                let dueDate = null;
                if (revType === 'rev2') {
                    dueDate = new Date(baseDate.getTime() + (2 * 24 * 60 * 60 * 1000));
                } else if (revType === 'rev4') {
                    const refDate = (rev2.done && rev2.completedAt) ? new Date(rev2.completedAt) : new Date(baseDate.getTime() + (2 * 24 * 60 * 60 * 1000));
                    refDate.setHours(0, 0, 0, 0);
                    dueDate = new Date(refDate.getTime() + (4 * 24 * 60 * 60 * 1000));
                } else if (revType === 'rev7') {
                    let refDate;
                    if (rev4.done && rev4.completedAt) {
                        refDate = new Date(rev4.completedAt);
                        refDate.setHours(0, 0, 0, 0);
                        dueDate = new Date(refDate.getTime() + (7 * 24 * 60 * 60 * 1000));
                    } else if (rev2.done && rev2.completedAt) {
                        refDate = new Date(rev2.completedAt);
                        refDate.setHours(0, 0, 0, 0);
                        dueDate = new Date(refDate.getTime() + (11 * 24 * 60 * 60 * 1000)); // 4+7
                    } else {
                        refDate = new Date(baseDate.getTime() + (6 * 24 * 60 * 60 * 1000));
                        refDate.setHours(0, 0, 0, 0);
                        dueDate = new Date(refDate.getTime() + (7 * 24 * 60 * 60 * 1000));
                    }
                }

                const shortDate = dueDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

                // Add visual indicator if it is actively overdue 
                // (Only rev2 can be actively overdue if rev2 not done. If rev2 not done, rev4 is theoretically overdue but hidden by dependency in dashboard)
                const todayDate = new Date();
                todayDate.setHours(0, 0, 0, 0);

                // It is only "actively" overdue to display in red if its prerequisite is met. 
                // e.g. rev4 is ONLY overdue if rev2 IS done but rev4 timeline passed.
                let isActivelyOverdue = false;
                if (todayDate > dueDate) {
                    if (revType === 'rev2') isActivelyOverdue = true;
                    if (revType === 'rev4' && rev2.done) isActivelyOverdue = true;
                    if (revType === 'rev7' && rev4.done) isActivelyOverdue = true;
                }

                const dateHtml = `<div class="status-date" style="${isActivelyOverdue ? 'color: #ef4444;' : 'color: var(--text-secondary); opacity: 0.7;'}">Due: ${shortDate}</div>`;

                return `
                    <div class="status-cell-wrapper">
                        <div class="status-cell pending" ${isActivelyOverdue ? 'style="border-color: #ef4444; color: #ef4444;"' : ''}>
                            <i class="fa-solid ${isActivelyOverdue ? 'fa-circle-exclamation' : 'fa-hourglass-start'}" style="${isActivelyOverdue ? '' : 'opacity:0.3;'}"></i>
                        </div>
                        ${dateHtml}
                    </div>
                `;
            }
        };

        tr.innerHTML = `
            <td style="font-weight: 500;">${session.topic}</td>
            <td style="color: var(--text-secondary);"><i class="fa-regular fa-calendar" style="margin-right: 0.5rem; opacity: 0.7;"></i>${session.dateRead}</td>
            <td class="center-col">${getStatusCell(session, 'rev2')}</td>
            <td class="center-col">${getStatusCell(session, 'rev4')}</td>
            <td class="center-col">${getStatusCell(session, 'rev7')}</td>
        `;

        revisionTableBody.appendChild(tr);
    });
}

// Export & Import Backup Logic
document.getElementById('btnExport').addEventListener('click', exportBackup);
document.getElementById('importFile').addEventListener('change', importBackup);
document.getElementById('btnDisconnectBackup').addEventListener('click', disconnectBackup);

function exportBackup() {
    // Study data backup only (insights have their own file unless specifically requested)
    const dataStr = btoa(JSON.stringify({ studySessions, timeLogs, aiRatingsHistory }));
    const dataBlob = new Blob([dataStr], { type: 'text/plain' });
    const url = URL.createObjectURL(dataBlob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `StudyTracker_Backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importBackup(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (event) {
        try {
            let fileContent = event.target.result;
            let importedData;

            // Check if it looks like JSON structure vs Base64 payload
            if (fileContent.trim().startsWith('[') || fileContent.trim().startsWith('{')) {
                // Trying traditional plain text backup
                importedData = JSON.parse(fileContent);
            } else {
                // Attempt to decode the base64 string
                const decodedStr = atob(fileContent);
                importedData = JSON.parse(decodedStr);
            }
            if (Array.isArray(importedData)) {
                studySessions = importedData;
                saveToLocalStorage();
                renderDashboard();
                renderTableView();
                alert('Backup successfully restored!');
            } else if (importedData && typeof importedData === 'object' && ('studySessions' in importedData || 'timeLogs' in importedData)) {
                if (importedData.studySessions) studySessions = importedData.studySessions;
                if (importedData.timeLogs) timeLogs = importedData.timeLogs;
                if (importedData.aiRatingsHistory) {
                    aiRatingsHistory = importedData.aiRatingsHistory;
                    localStorage.setItem('aiRatingsHistory', JSON.stringify(aiRatingsHistory));
                }
                saveToLocalStorage();
                renderDashboard();
                renderTableView();
                renderTimeLogs();
                alert('Backup successfully restored!');
            } else {
                alert('Invalid backup format.');
            }
        } catch (error) {
            alert('Error parsing backup file. Make sure it is a valid JSON.');
        }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset file input
}

// Auto-Backup via File System Access API
document.getElementById('btnAutoBackup').addEventListener('click', setupAutoBackup);

function updateBackupUIVisually() {
    const btn = document.getElementById('btnAutoBackup');
    btn.innerHTML = '<i class="fa-solid fa-folder-check"></i> <span>Auto-Backup Active</span>';
    btn.style.background = 'rgba(16, 185, 129, 0.2)';
    btn.style.color = '#34d399';
    btn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    document.getElementById('btnDisconnectBackup').style.display = 'flex';
}

async function restoreAutoBackupSettings() {
    try {
        const storedHandle = await idb.get('autoBackupFolderHandle');
        if (!storedHandle) return;

        // ALWAYS keep the handle reference even if permission isn't granted yet.
        // This ensures the folder NEVER "unlinks" — we just need to re-request
        // permission when the user interacts with the page.
        backupDirHandle = storedHandle;

        // Try to verify readwrite permission (not just read)
        const hasPermission = await verifyPermission(storedHandle, true);
        if (hasPermission) {
            updateBackupUIVisually();
        } else {
            // Permission not granted yet (browser requires user gesture).
            // Show "reconnect" state — clicking will re-request permission.
            const btn = document.getElementById('btnAutoBackup');
            btn.innerHTML = '<i class="fa-solid fa-folder-open"></i> <span>Reconnect Folder</span>';
            btn.style.background = 'rgba(245, 158, 11, 0.2)';
            btn.style.color = '#fbbf24';
            btn.style.borderColor = 'rgba(245, 158, 11, 0.4)';
            document.getElementById('btnDisconnectBackup').style.display = 'flex';
        }
    } catch (e) {
        console.warn("Could not restore backup handle from IDB", e);
        // Even on error, try to keep the handle if we have it
        try {
            const storedHandle = await idb.get('autoBackupFolderHandle');
            if (storedHandle) backupDirHandle = storedHandle;
        } catch (_) { }
    }
}

async function verifyPermission(fileHandle, readWrite) {
    try {
        const options = {};
        if (readWrite) options.mode = 'readwrite';
        if ((await fileHandle.queryPermission(options)) === 'granted') return true;
        if ((await fileHandle.requestPermission(options)) === 'granted') return true;
        return false;
    } catch (e) {
        console.warn('Permission check failed:', e);
        return false;
    }
}

async function setupAutoBackup() {
    try {
        if (!window.showDirectoryPicker) {
            alert("Your browser does not support the File System Access API. Please use Chrome.");
            return;
        }

        // If we already have a stored handle, try to re-grant permission
        // instead of picking a new folder (prevents accidental unlinking)
        if (backupDirHandle) {
            const hasPermission = await verifyPermission(backupDirHandle, true);
            if (hasPermission) {
                updateBackupUIVisually();
                await autoBackupSync();
                showToast('Backup folder reconnected successfully! ✅', 'success');
                return;
            }
        }

        // No existing handle or permission denied — pick a new folder
        backupDirHandle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'studytrackerBackupDir' });
        await idb.set('autoBackupFolderHandle', backupDirHandle);
        updateBackupUIVisually();
        await autoBackupSync();
        showToast('Auto-Backup linked! Data will save to the selected folder automatically.', 'success');
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error(error);
            alert("Failed to setup Auto-Backup. Ensure you grant permission.");
        }
    }
}

async function autoBackupSync() {
    if (!backupDirHandle) return;
    try {
        const hasPermission = await verifyPermission(backupDirHandle, true);
        if (!hasPermission) {
            // Don't clear the handle! Just skip this sync silently.
            // The handle stays in IDB for next session's recovery.
            console.warn('Auto-backup skipped: permission not granted (will retry next interaction)');
            return;
        }
        const fileHandle = await backupDirHandle.getFileHandle('StudyTracker_AutoBackup.backup', { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(btoa(JSON.stringify({ studySessions, timeLogs, aiRatingsHistory })));
        await writable.close();
    } catch (error) {
        console.error("Auto-Backup save failed:", error);
        // NEVER clear backupDirHandle here — keep it for future recovery attempts
    }
}

// Make accessible to inline onclick handlers gracefully
window.completeRevision = completeRevision;
window.deleteSession = deleteSession;
window.deleteTimeLog = deleteTimeLog;
window.editTimeLog = editTimeLog;

// ==========================================
// AI INSIGHTS TAB
// ==========================================

let currentPeriod = 'today';
let chartInstances = {}

async function disconnectBackup() {
    if (!confirm("Disconnect Auto-Backup folder? Your data will stop syncing automatically to the folder.\n\nUse this before letting Agent bots test the app so they don't overwrite your real backups.")) return;

    backupDirHandle = null;
    await idb.delete('autoBackupFolderHandle');

    const btn = document.getElementById('btnAutoBackup');
    btn.innerHTML = '<i class="fa-solid fa-folder-tree"></i> <span>Auto-Backup</span>';
    btn.style.background = 'transparent';
    btn.style.color = 'inherit';
    btn.style.borderColor = 'transparent';

    document.getElementById('btnDisconnectBackup').style.display = 'none';
    showToast('Auto-backup folder disconnected', 'info');
};

// --- API Key Management ---
const apiKeyInput = document.getElementById('geminiApiKeyInput');
const apiKeyStatus = document.getElementById('apiKeyStatus');
const btnSaveApiKey = document.getElementById('btnSaveApiKey');

function loadApiKey() {
    const key = localStorage.getItem('groqApiKey');
    if (key) {
        apiKeyInput.value = '';
        apiKeyInput.placeholder = '••••••••' + key.slice(-4);
        apiKeyStatus.textContent = 'API key saved ✓';
        apiKeyStatus.className = 'api-key-active';
    } else {
        apiKeyStatus.innerHTML = 'No API key configured — <a href="https://console.groq.com/keys" target="_blank" style="color: #a5b4fc; text-decoration: underline;">Get free key here</a>';
        apiKeyStatus.className = 'api-key-missing';
    }
}

btnSaveApiKey.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
        alert('Please enter your Groq API key.');
        return;
    }
    localStorage.setItem('groqApiKey', key);
    loadApiKey();
});

loadApiKey();

// --- AI Insights Storage (Latest Only) ---
// Only keeps the LATEST insights. Old ones are deleted when new ones are generated.

// --- AI Insights (keep latest in localStorage to survive refresh) ---

let lastInsightsPeriod = null;

function saveLatestInsights(feedbackHtml, chartData, periodLabel, ratingObj) {
    localStorage.setItem('aiLatestInsights', JSON.parse(JSON.stringify({
        feedback: feedbackHtml,
        chartData: chartData || null,
        period: periodLabel,
        rating: ratingObj || null,
        timestamp: Date.now()
    })));
}

function loadLatestInsights() {
    try {
        const data = JSON.parse(localStorage.getItem('aiLatestInsights') || 'null');
        if (!data || !data.feedback) return;
        const contentEl = document.getElementById('aiFeedbackContent');
        contentEl.innerHTML = data.feedback;
        if (data.chartData && data.chartData.subjectHours) {
            renderSubjectDistChartWithData(data.chartData.subjectHours);
        }
        if (data.rating) {
            renderStarRating(data.rating.score);
        } else {
            document.getElementById('aiRatingContainer').style.display = 'none';
        }
        lastInsightsPeriod = data.period;
        updateHistoryStatus();
    } catch (e) { /* ignore */ }
}

function updateHistoryStatus() {
    const statusEl = document.getElementById('insightsHistoryStatus');
    if (!statusEl) return;
    if (lastInsightsPeriod) {
        statusEl.textContent = `Last: ${lastInsightsPeriod}`;
    } else {
        statusEl.textContent = 'Click Generate to analyze';
    }
}

// Date picker initialization
const insightsDatePicker = document.getElementById('insightsDatePicker');
insightsDatePicker.value = new Date().toISOString().split('T')[0];

insightsDatePicker.addEventListener('change', () => {
    renderAllCharts();
});

document.getElementById('btnPrevDay').addEventListener('click', () => {
    const d = new Date(insightsDatePicker.value);
    d.setDate(d.getDate() - 1);
    insightsDatePicker.value = d.toISOString().split('T')[0];
    renderAllCharts();
});

document.getElementById('btnNextDay').addEventListener('click', () => {
    const d = new Date(insightsDatePicker.value);
    d.setDate(d.getDate() + 1);
    const today = new Date().toISOString().split('T')[0];
    if (d.toISOString().split('T')[0] <= today) {
        insightsDatePicker.value = d.toISOString().split('T')[0];
        renderAllCharts();
    }
});

// Load latest insights on init
setTimeout(() => {
    loadLatestInsights();
}, 500);

// --- Period Selector ---
document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPeriod = btn.dataset.period;
        renderAllCharts();
    });
});

// --- Data Helpers ---
function getDateRange(period) {
    // Use date picker value as reference date (defaults to today)
    const picker = document.getElementById('insightsDatePicker');
    const refDate = picker && picker.value ? new Date(picker.value + 'T00:00:00') : new Date();
    refDate.setHours(0, 0, 0, 0);
    const end = new Date(refDate);
    end.setHours(23, 59, 59, 999);

    let start = new Date(refDate);
    if (period === 'week') {
        start.setDate(start.getDate() - 6); // 7 days ending on selected date
    } else if (period === 'month') {
        start.setDate(start.getDate() - 29); // 30 days ending on selected date
    }
    return { start, end };
}

function getFilteredLogs(period) {
    const { start, end } = getDateRange(period);
    return timeLogs.filter(log => {
        const d = new Date(log.date);
        d.setHours(12, 0, 0, 0); // Normalize
        return d >= start && d <= end;
    });
}

function formatDateLabel(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// --- Chart Colors ---
const CHART_COLORS = {
    indigo: { bg: 'rgba(99, 102, 241, 0.2)', border: '#6366f1', fill: 'rgba(99, 102, 241, 0.1)' },
    pink: { bg: 'rgba(236, 72, 153, 0.2)', border: '#ec4899' },
    emerald: { bg: 'rgba(16, 185, 129, 0.2)', border: '#10b981' },
    amber: { bg: 'rgba(245, 158, 11, 0.2)', border: '#f59e0b' },
    sky: { bg: 'rgba(14, 165, 233, 0.2)', border: '#0ea5e9' },
    red: { bg: 'rgba(239, 68, 68, 0.2)', border: '#ef4444' },
};

const SUBJECT_CHART_COLORS = {
    'Physics': '#818cf8',
    'Chemistry': '#f472b6',
    'Maths': '#fb923c',
    'Computer': '#34d399',
    'English': '#38bdf8',
    'Nepali': '#a78bfa',
};

// Chart.js global defaults for dark theme
Chart.defaults.color = 'rgba(255,255,255,0.6)';
Chart.defaults.borderColor = 'rgba(255,255,255,0.07)';
Chart.defaults.font.family = 'Outfit, sans-serif';

// --- Chart 1: Study Hours Trend ---
function renderStudyHoursChart() {
    const { start } = getDateRange(currentPeriod);
    const logs = getFilteredLogs(currentPeriod);

    // Build date labels and data
    const dateMap = {};
    const numDays = currentPeriod === 'today' ? 1 : currentPeriod === 'week' ? 7 : 30;

    for (let i = 0; i < numDays; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        const key = d.toISOString().split('T')[0];
        dateMap[key] = 0;
    }

    logs.forEach(log => {
        if (dateMap[log.date] !== undefined) {
            dateMap[log.date] += log.duration;
        }
    });

    const labels = Object.keys(dateMap).map(formatDateLabel);
    const data = Object.values(dateMap).map(v => parseFloat(v.toFixed(2)));

    const ctx = document.getElementById('chartStudyHours').getContext('2d');

    if (chartInstances.studyHours) chartInstances.studyHours.destroy();

    const gradient = ctx.createLinearGradient(0, 0, 0, 250);
    gradient.addColorStop(0, 'rgba(99, 102, 241, 0.4)');
    gradient.addColorStop(1, 'rgba(99, 102, 241, 0.0)');

    chartInstances.studyHours = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Hours',
                data,
                borderColor: '#6366f1',
                backgroundColor: gradient,
                borderWidth: 2.5,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#6366f1',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: data.length <= 7 ? 5 : 3,
                pointHoverRadius: 7,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleColor: '#fff',
                    bodyColor: '#a5b4fc',
                    borderColor: 'rgba(99,102,241,0.3)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 10,
                    callbacks: {
                        label: (ctx) => `${ctx.parsed.y} hours`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: { callback: v => v + 'h' }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

// --- Chart 2: Subject Distribution ---
function renderSubjectDistChart() {
    const logs = getFilteredLogs(currentPeriod);
    const subjectHours = {};

    // Use explicit subject field if available, fall back to keyword matching for legacy logs
    const subjectKeywords = {
        'Physics': ['physics', 'phys', 'mechanics', 'thermodynamics', 'optics', 'waves', 'electro'],
        'Chemistry': ['chemistry', 'chem', 'organic', 'inorganic', 'reaction', 'chemical'],
        'Maths': ['math', 'maths', 'calculus', 'algebra', 'geometry', 'trigonometry', 'integration', 'differentiation'],
        'Computer': ['computer', 'coding', 'programming', 'code', 'software', 'algorithm', 'data structure', 'web', 'html', 'css', 'js', 'python'],
        'English': ['english', 'essay', 'grammar', 'literature', 'writing', 'reading', 'comprehension'],
        'Nepali': ['nepali', 'nepal']
    };

    logs.forEach(log => {
        // Prefer explicit subject tag
        if (log.subject) {
            subjectHours[log.subject] = (subjectHours[log.subject] || 0) + log.duration;
            return;
        }
        // Legacy fallback: keyword matching
        const taskLower = (log.task + ' ' + (log.notes || '')).toLowerCase();
        let matched = false;
        for (const [subject, keywords] of Object.entries(subjectKeywords)) {
            if (keywords.some(kw => taskLower.includes(kw))) {
                subjectHours[subject] = (subjectHours[subject] || 0) + log.duration;
                matched = true;
                break;
            }
        }
        if (!matched) {
            subjectHours['Other'] = (subjectHours['Other'] || 0) + log.duration;
        }
    });

    const labels = Object.keys(subjectHours);
    const data = Object.values(subjectHours).map(v => parseFloat(v.toFixed(2)));
    const colors = labels.map(l => SUBJECT_CHART_COLORS[l] || '#64748b');

    const ctx = document.getElementById('chartSubjectDist').getContext('2d');
    if (chartInstances.subjectDist) chartInstances.subjectDist.destroy();

    chartInstances.subjectDist = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                borderColor: 'rgba(15, 23, 42, 0.8)',
                borderWidth: 3,
                hoverBorderColor: '#fff',
                hoverBorderWidth: 2,
                hoverOffset: 8,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        padding: 15,
                        usePointStyle: true,
                        pointStyleWidth: 10,
                        font: { size: 12 },
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleColor: '#fff',
                    bodyColor: '#a5b4fc',
                    borderColor: 'rgba(99,102,241,0.3)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 10,
                    callbacks: {
                        label: (ctx) => `${ctx.label}: ${ctx.parsed} hrs`
                    }
                }
            }
        }
    });
}

// --- Chart 3: Peak Productivity Hours ---
function renderPeakHoursChart() {
    const logs = getFilteredLogs(currentPeriod);
    // Count hours worked per hour-of-day slot
    const hourBuckets = new Array(24).fill(0);

    logs.forEach(log => {
        const startH = parseInt(log.startTime.split(':')[0]);
        const endH = parseInt(log.endTime.split(':')[0]);
        // Distribute duration across hours
        if (startH <= endH) {
            for (let h = startH; h <= endH && h < 24; h++) {
                hourBuckets[h] += log.duration / (endH - startH + 1);
            }
        } else { // overnight
            for (let h = startH; h < 24; h++) {
                hourBuckets[h] += log.duration / (24 - startH + endH + 1);
            }
            for (let h = 0; h <= endH; h++) {
                hourBuckets[h] += log.duration / (24 - startH + endH + 1);
            }
        }
    });

    // Show full 24 hours for complete daily pattern
    const slicedData = hourBuckets.map(v => parseFloat(v.toFixed(2)));
    const labels = [];
    for (let h = 0; h < 24; h++) {
        const ampm = h >= 12 ? 'PM' : 'AM';
        const hour12 = h % 12 || 12;
        labels.push(`${hour12}${ampm}`);
    }

    // Color gradient: low hours get muted, high hours get vibrant
    const maxVal = Math.max(...slicedData, 0.1);
    const barColors = slicedData.map(v => {
        const intensity = v / maxVal;
        return `rgba(16, 185, 129, ${0.2 + intensity * 0.7})`;
    });

    const ctx = document.getElementById('chartPeakHours').getContext('2d');
    if (chartInstances.peakHours) chartInstances.peakHours.destroy();

    chartInstances.peakHours = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Hours',
                data: slicedData,
                backgroundColor: barColors,
                borderColor: 'rgba(16, 185, 129, 0.6)',
                borderWidth: 1,
                borderRadius: 6,
                borderSkipped: false,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleColor: '#fff',
                    bodyColor: '#34d399',
                    borderColor: 'rgba(16,185,129,0.3)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 10,
                    callbacks: {
                        label: (ctx) => `${ctx.parsed.y.toFixed(1)} hrs active`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: { callback: v => v + 'h' }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 10 } }
                }
            }
        }
    });
}

// --- Chart 4: Revision Completion Rate ---
function renderRevisionChart() {
    let completed = 0;
    let pending = 0;
    let overdue = 0;

    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    studySessions.forEach(session => {
        const baseDate = new Date(session.dateRead);
        baseDate.setHours(0, 0, 0, 0);

        ['rev2', 'rev4', 'rev7'].forEach(revType => {
            const rev = typeof session.revisions[revType] === 'boolean'
                ? { done: session.revisions[revType], completedAt: null }
                : session.revisions[revType];

            if (rev.done) {
                completed++;
            } else {
                // Check if overdue
                let dueDate = null;
                const rev2 = typeof session.revisions.rev2 === 'boolean' ? { done: session.revisions.rev2 } : session.revisions.rev2;
                const rev4 = typeof session.revisions.rev4 === 'boolean' ? { done: session.revisions.rev4 } : session.revisions.rev4;

                if (revType === 'rev2') dueDate = new Date(baseDate.getTime() + 2 * 86400000);
                else if (revType === 'rev4' && rev2.done) dueDate = new Date(baseDate.getTime() + 6 * 86400000);
                else if (revType === 'rev7' && rev4.done) dueDate = new Date(baseDate.getTime() + 13 * 86400000);

                if (dueDate && todayDate > dueDate) {
                    overdue++;
                } else {
                    pending++;
                }
            }
        });
    });

    const ctx = document.getElementById('chartRevisionRate').getContext('2d');
    if (chartInstances.revisionRate) chartInstances.revisionRate.destroy();

    chartInstances.revisionRate = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Completed', 'Pending', 'Overdue'],
            datasets: [{
                data: [completed, pending, overdue],
                backgroundColor: ['#10b981', '#6366f1', '#ef4444'],
                borderColor: 'rgba(15, 23, 42, 0.8)',
                borderWidth: 3,
                hoverBorderColor: '#fff',
                hoverBorderWidth: 2,
                hoverOffset: 8,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        padding: 15,
                        usePointStyle: true,
                        pointStyleWidth: 10,
                        font: { size: 12 },
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleColor: '#fff',
                    bodyColor: '#a5b4fc',
                    borderColor: 'rgba(99,102,241,0.3)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 10,
                    callbacks: {
                        label: (ctx) => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(0) : 0;
                            return `${ctx.label}: ${ctx.parsed} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

function renderAllCharts() {
    renderStudyHoursChart();
    renderSubjectDistChart();
    renderPeakHoursChart();
    renderRevisionChart();

    // Update date range labels on charts
    const { start, end } = getDateRange(currentPeriod);
    const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const rangeText = currentPeriod === 'today'
        ? fmt(end)
        : `${fmt(start)} – ${fmt(end)}`;

    ['chartRangeStudy', 'chartRangeSubject', 'chartRangePeak', 'chartRangeRev'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = `📅 ${rangeText}`;
    });
}

// --- Gemini AI Integration ---
document.getElementById('btnGenerateInsights').addEventListener('click', generateAIInsights);

async function generateAIInsights() {
    const apiKey = localStorage.getItem('groqApiKey');
    if (!apiKey) {
        alert('Please save your Groq API key first. Get one free at console.groq.com');
        return;
    }

    const btn = document.getElementById('btnGenerateInsights');
    const loadingEl = document.getElementById('aiLoadingIndicator');
    const contentEl = document.getElementById('aiFeedbackContent');

    btn.disabled = true;
    loadingEl.style.display = 'flex';
    contentEl.innerHTML = '<div class="ai-placeholder"><p>Analyzing your study data...</p></div>';

    let aiChartData = null; // Track chart data for saving

    try {
        const logs = getFilteredLogs(currentPeriod);
        const periodLabel = currentPeriod === 'today' ? "today" : currentPeriod === 'week' ? "the past 7 days" : "the past 30 days";

        // Build data summary
        let totalHours = 0;
        const taskSummaries = [];
        const dailyBreakdown = {};

        logs.forEach(log => {
            totalHours += log.duration;
            const timeSlot = `${log.startTime}-${log.endTime}`;
            const subjectTag = (log.subject && log.subject !== 'General / Other') ? ` [Tagged: ${log.subject}]` : '';
            taskSummaries.push(`${log.date} | ${timeSlot} | ${log.duration}h | "${log.task}"${subjectTag}${log.notes ? ' — ' + log.notes : ''}`);
            dailyBreakdown[log.date] = (dailyBreakdown[log.date] || 0) + log.duration;
        });

        // Study sessions summary
        let revDone = 0, revTotal = 0;
        studySessions.forEach(s => {
            ['rev2', 'rev4', 'rev7'].forEach(r => {
                revTotal++;
                const rev = typeof s.revisions[r] === 'boolean' ? { done: s.revisions[r] } : s.revisions[r];
                if (rev.done) revDone++;
            });
        });

        const rawLogData = taskSummaries.length > 0 ? taskSummaries.join('\n') : 'No activities logged.';

        // --- Call 1: AI Chart Data (structured JSON) ---
        const chartPrompt = `You are a study activity categorizer. Read each activity's task name AND notes carefully to determine the real subject. Do NOT rely on tags — many are set to "General / Other" by default and are WRONG.

Activity Logs:
${rawLogData}

Subjects to categorize into: Physics, Chemistry, Maths, Computer, English, Nepali, Sleep, Meditation, Other

Categorization rules:
- READ the task name and notes to understand what was actually studied
- "Math - Parabola", "integration", "calculus", "exercise" about math topics = Maths
- "Physics paper", "physics tactics" = Physics  
- "Chemistry", "carboxylic acid", "organic chemistry" = Chemistry
- "App development", "coding", "programming", "web dev", "made app" = Computer
- "Meditation", "stretches", "morning ritual" = Meditation
- "Sleep", "nap" = Sleep
- "Wasted time", "not productive", "unproductive" = Other
- If a [Tagged: X] label exists AND is not "General / Other", use it
- IGNORE any "General / Other" tags completely

Return ONLY valid JSON:
{"subjectHours": {"Maths": 2.5, "Physics": 2.0, "Computer": 4.0}}

Only include subjects with hours > 0. Use exact decimal hours from the logs.`;

        const chartResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: chartPrompt }],
                temperature: 0.1,
                max_tokens: 300,
            })
        });

        if (chartResponse.ok) {
            const chartResult = await chartResponse.json();
            const chartText = chartResult.choices?.[0]?.message?.content || '';
            try {
                // Extract JSON from response (handle markdown code blocks)
                const jsonMatch = chartText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const chartData = JSON.parse(jsonMatch[0]);
                    if (chartData.subjectHours) {
                        // Update Subject Distribution chart with AI data
                        renderSubjectDistChartWithData(chartData.subjectHours);
                        aiChartData = chartData;
                    }
                }
            } catch (parseErr) {
                console.warn('Could not parse AI chart data, using local calculation:', parseErr);
            }
        }

        // Build chart-specific data for AI to reference
        // Peak hours data
        const hourBuckets = new Array(24).fill(0);
        logs.forEach(log => {
            const startH = parseInt(log.startTime.split(':')[0]);
            const endH = parseInt(log.endTime.split(':')[0]);
            if (startH <= endH) {
                for (let h = startH; h <= endH && h < 24; h++) {
                    hourBuckets[h] += log.duration / (endH - startH + 1);
                }
            }
        });
        const peakHoursSummary = hourBuckets
            .map((v, i) => ({ hour: i, value: parseFloat(v.toFixed(2)) }))
            .filter(h => h.value > 0)
            .sort((a, b) => b.value - a.value)
            .slice(0, 5)
            .map(h => `${h.hour % 12 || 12}${h.hour >= 12 ? 'PM' : 'AM'}: ${h.value}h`)
            .join(', ');

        // Subject hours from logs
        const subjectBreakdown = {};
        logs.forEach(log => {
            const subj = log.subject || 'Uncategorized';
            subjectBreakdown[subj] = (subjectBreakdown[subj] || 0) + log.duration;
        });
        const subjectSummary = Object.entries(subjectBreakdown)
            .sort(([, a], [, b]) => b - a)
            .map(([s, h]) => `${s}: ${h.toFixed(1)}h`)
            .join(', ');

        // --- Call 2: AI Feedback Text (Real Mentor) ---
        // Build lifetime context
        const allLogs = timeLogs || [];
        const lifetimeTotalHours = allLogs.reduce((sum, l) => sum + l.duration, 0);
        const allSubjects = {};
        allLogs.forEach(l => {
            const s = l.subject || 'Other';
            allSubjects[s] = (allSubjects[s] || 0) + l.duration;
        });
        const lifetimeSubjectSummary = Object.entries(allSubjects)
            .sort(([, a], [, b]) => b - a)
            .map(([s, h]) => `${s}: ${h.toFixed(1)}h`)
            .join(', ');

        // Build study sessions context
        const sessionsContext = studySessions.slice(0, 20).map(s => {
            const revStatus = ['rev2', 'rev4', 'rev7'].map(r => {
                const rev = typeof s.revisions[r] === 'boolean' ? { done: s.revisions[r] } : s.revisions[r];
                return `${r}: ${rev.done ? '✅' : '❌'}`;
            }).join(', ');
            return `- ${s.subject}/${s.topic} (read: ${s.dateRead}) → ${revStatus}`;
        }).join('\n');

        const feedbackPrompt = `You are this student's personal study mentor. You have their COMPLETE activity log with exact times, task names, and notes. Read EVERY activity carefully. Understand what they actually did, not just the subject tags.

## IMPORTANT CONTEXT
This student has GRADED ACADEMIC SUBJECTS and PERSONAL INTERESTS. Distinguish them:
- ACADEMIC (graded, exams): Physics, Chemistry, Maths, English, Nepali — these decide their grades
- PERSONAL INTEREST (not graded): App development, coding projects, robotics — valuable skills but NOT on their syllabus
- WELLNESS (not study): Meditation, sleep, stretches — important for health, not study hours
- UNPRODUCTIVE: Wasted time, couldn't concentrate — lost hours

When analyzing, ALWAYS separate academic study hours from personal interest hours. The student needs to know: "Out of 17h logged, only Xh were actual syllabus study."

## ALL-TIME DATA
- Total hours logged: ${lifetimeTotalHours.toFixed(1)}h across ${allLogs.length} activities
- Study sessions being tracked: ${studySessions.length}

## CURRENT PERIOD: ${periodLabel}
- Total hours: ${totalHours.toFixed(1)}h | Activities: ${logs.length} | Active days: ${Object.keys(dailyBreakdown).length}
- Revision completion: ${revDone}/${revTotal}

## DETAILED ACTIVITY LOG (read each one carefully):
${rawLogData}

## Daily Totals: ${Object.entries(dailyBreakdown).map(([d, h]) => `${d}: ${h.toFixed(1)}h`).join(' | ') || 'No data'}
## Peak Hours: ${peakHoursSummary || 'No data'}

## Study Sessions (spaced repetition):
${sessionsContext || 'None yet'}

## YOUR TASK

Read each activity above carefully. Understand:
- What SUBJECT each activity actually belongs to ("Math - Parabola" = Maths, "App development" = Personal Interest, "Physics paper" = Physics)
- Separate ACADEMIC hours (graded subjects) from PERSONAL INTEREST hours (side projects)
- Which activities were PRODUCTIVE vs UNPRODUCTIVE ("wasted time", "not able to concentrate")
- The student's day flow: when they started, breaks, transitions between subjects

Now analyze:
1. ACADEMIC vs NON-ACADEMIC split: How many hours went to actual graded subjects vs personal projects? Be blunt.
2. Subject-wise breakdown of ACADEMIC hours only: Which subjects got time? Which are dangerously neglected?
3. Productive vs unproductive hours: call out specific wasted time slots
4. Schedule analysis: Are they using their best morning hours for hard subjects or wasting them?
5. Revision discipline: Are they doing their 2-4-7 reviews? This is critical for retention.
6. Personal interests assessment: Are side projects eating into study time? Should they be scheduled differently?

End with a concrete, specific action plan for tomorrow with exact time blocks.
Be brutally honest. Reference specific activities by name and time. This student wants REAL coaching, not encouragement.

CRITICAL FINAL INSTRUCTION:
At the very end of your response, on a new line, you MUST provide an overall rating of the student's performance out of 10 based on their discipline, focus, and adherence to academic subjects vs distractions.
Format it EXACTLY like this with no extra spaces or words around the brackets:
[[RATING: X/10]]
Where X is a number from 1 to 10.`;



        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: feedbackPrompt }],
                temperature: 0.7,
                max_tokens: 3000,
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || `API request failed(${response.status})`);
        }

        const result = await response.json();
        let aiText = result.choices?.[0]?.message?.content;

        if (!aiText) throw new Error('No response from AI');

        // Extract Rating
        let ratingObj = null;
        const ratingMatch = aiText.match(/\[\[RATING:\s*(\d+)\/10\]\]/i);
        if (ratingMatch) {
            const score = parseInt(ratingMatch[1], 10);
            ratingObj = { score: score };

            // Remove the rating bracket from the visual text
            aiText = aiText.replace(/\[\[RATING:\s*\d+\/10\]\]/gi, '').trim();

            // Save to history list
            aiRatingsHistory.push({
                timestamp: Date.now(),
                dateLabel: new Date().toLocaleDateString(),
                period: currentPeriod,
                score: score
            });
            localStorage.setItem('aiRatingsHistory', JSON.stringify(aiRatingsHistory));

            // Trigger auto-backup so it syncs this new history
            autoBackupSync();

            // Render on UI
            renderStarRating(score);
        } else {
            document.getElementById('aiRatingContainer').style.display = 'none';
        }

        const feedbackHtml = markdownToHtml(aiText);
        contentEl.innerHTML = feedbackHtml;

        // Save latest to localStorage (survives refresh)
        const periodNames = { today: 'Today', week: 'This Week', month: 'This Month' };
        lastInsightsPeriod = `${periodNames[currentPeriod]} (${new Date().toLocaleDateString()})`;
        saveLatestInsights(feedbackHtml, aiChartData, lastInsightsPeriod, ratingObj);
        updateHistoryStatus();

    } catch (error) {
        console.error('AI Insights error:', error);
        contentEl.innerHTML = `
            < div class="ai-placeholder" style = "color: #fca5a5;" >
                <i class="fa-solid fa-triangle-exclamation" style="-webkit-text-fill-color: #fca5a5; background: none;"></i>
                <p><strong>Error:</strong> ${error.message}</p>
                <p style="font-size: 0.9rem; margin-top: 0.5rem;">Check your API key or try again.</p>
            </div > `;
    } finally {
        btn.disabled = false;
        loadingEl.style.display = 'none';
    }
}

// Render Subject Distribution chart with AI-provided data
function renderSubjectDistChartWithData(subjectHoursData) {
    // Filter out zero-hour subjects
    const filtered = Object.entries(subjectHoursData).filter(([, h]) => h > 0);
    if (filtered.length === 0) return;

    const labels = filtered.map(([s]) => s);
    const data = filtered.map(([, h]) => parseFloat(h.toFixed(2)));
    const colors = labels.map(l => SUBJECT_CHART_COLORS[l] || '#64748b');

    const ctx = document.getElementById('chartSubjectDist').getContext('2d');
    if (chartInstances.subjectDist) chartInstances.subjectDist.destroy();

    chartInstances.subjectDist = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                borderColor: 'rgba(15, 23, 42, 0.8)',
                borderWidth: 3,
                hoverBorderColor: '#fff',
                hoverBorderWidth: 2,
                hoverOffset: 8,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'right',
                    labels: { padding: 15, usePointStyle: true, pointStyleWidth: 10, font: { size: 12 } }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleColor: '#fff',
                    bodyColor: '#a5b4fc',
                    borderColor: 'rgba(99,102,241,0.3)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 10,
                    callbacks: {
                        label: (ctx) => `${ctx.label}: ${ctx.parsed} hrs(AI analyzed)`
                    }
                }
            }
        }
    });
}

// Simple Markdown to HTML converter
function markdownToHtml(md) {
    let html = md
        // Headers
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        // Bold & Italic
        .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // Inline code
        .replace(/`(.+?)`/g, '<code>$1</code>')
        // Unordered lists
        .replace(/^[\-\*] (.+)$/gm, '<li>$1</li>')
        // Ordered lists
        .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
        // Line breaks
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>');

    // Wrap consecutive <li> in <ul>
    html = html.replace(/(<li>.*?<\/li>)(?:<br>)*/gs, (match) => {
        return '<ul>' + match.replace(/<br>/g, '') + '</ul>';
    });

    return '<p>' + html + '</p>';
}

// --- Wire up Insights tab rendering ---
// When switching to insights view, render charts
const originalNavHandler = navBtns.forEach;
navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.dataset.view === 'insightsView') {
            setTimeout(renderAllCharts, 100);
        }
    });
});

// Render Star Rating UI based on numeric score
function renderStarRating(score) {
    const container = document.getElementById('aiRatingContainer');
    const numberEl = document.getElementById('aiRatingNumber');
    const starsEl = document.getElementById('aiRatingStars');

    numberEl.textContent = score;
    let starsHtml = '';

    // We want exactly 10 stars total
    for (let i = 1; i <= 10; i++) {
        if (i <= score) {
            starsHtml += '<i class="fa-solid fa-star filled"></i>';
        } else {
            starsHtml += '<i class="fa-regular fa-star"></i>';
        }
    }

    starsEl.innerHTML = starsHtml;
    container.style.display = 'flex';
}

// Bootstrap Application
init();
