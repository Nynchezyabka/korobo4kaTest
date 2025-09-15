// Переменная для хранения задач
let tasks = [];

// Функции для работы с localStorage
function sanitizeStoredText(s) {
    if (typeof s !== 'string') return s;
    let t = s.replace(/\uFFFD/g, '');
    t = t.replace(/&shy;|&#173;|\u00AD/g, '');
    t = t.replace(/\u200B/g, '');
    t = t.replace(/[\r\n]+/g, ' ');
    t = t.replace(/\s{2,}/g, ' ').trim();
    return t;
}

function loadTasks() {
    const tasksJSON = localStorage.getItem('tasks');
    if (tasksJSON) {
        tasks = JSON.parse(tasksJSON);
        // sanitize stored texts
        tasks = tasks.map(t => ({ ...t, text: sanitizeStoredText(t.text) }));
        localStorage.setItem('tasks', JSON.stringify(tasks));
    } else {
        tasks = [];
    }
    // sanitize custom subcategories if any
    try {
        const customSubsRaw = localStorage.getItem('customSubcategories');
        if (customSubsRaw) {
            const cs = JSON.parse(customSubsRaw);
            Object.keys(cs).forEach(k => {
                cs[k] = cs[k].map(v => sanitizeStoredText(v));
            });
            // Migration: remove built-in duplicates (Home/Work/Дом/Работа) from custom list for category 1
            const c1 = cs['1'] || cs[1];
            if (Array.isArray(c1)) {
                const filtered = [];
                const seen = new Set();
                c1.forEach(v => {
                    const norm = normalizeSubcategoryName(1, v);
                    if (norm === 'home' || norm === 'work') return;
                    const tag = (norm || v).toLowerCase();
                    if (!seen.has(tag)) { seen.add(tag); filtered.push(v); }
                });
                cs[1] = filtered;
            }
            localStorage.setItem('customSubcategories', JSON.stringify(cs));
        }
    } catch (e) {}

    // Migration: normalize existing tasks subcategory names for category 1
    try {
        tasks = tasks.map(t => {
            if (t && t.category === 1 && typeof t.subcategory === 'string' && t.subcategory.trim()) {
                const norm = normalizeSubcategoryName(1, t.subcategory);
                if (norm) return { ...t, subcategory: norm };
                const { subcategory, ...rest } = t; return rest;
            }
            return t;
        });
        saveTasks();
    } catch (e) {}
    return tasks;
}

function saveTasks() {
    localStorage.setItem('tasks', JSON.stringify(tasks));
}

function getNextId() {
    let maxId = 0;
    tasks.forEach(task => {
        if (task.id > maxId) maxId = task.id;
    });
    return maxId + 1;
}

// Helpers for subcategory normalization/localization
function normalizeSubcategoryName(category, name) {
    if (!name || typeof name !== 'string') return null;
    const n = name.trim().toLowerCase();
    if (String(category) === '1') {
        if (['work','работа','rabota'].includes(n)) return 'work';
        if (['home','дом','doma','house'].includes(n)) return 'home';
    }
    return name.trim();
}
function getSubcategoryLabel(category, key) {
    if (!key) return '';
    if (String(category) === '1') {
        if (key === 'work') return 'Работа';
        if (key === 'home') return 'Дом';
        if (key.toLowerCase() === 'работа') return 'Работа';
        if (key.toLowerCase() === 'дом') return 'Дом';
    }
    return key;
}

// Add multiple lines as tasks helper
function addLinesAsTasks(lines, category = 0, selectedSub = null) {
    if (!Array.isArray(lines) || lines.length === 0) return;
    lines.forEach(raw => {
        const text = (typeof raw === 'string') ? raw.trim() : String(raw);
        if (!text) return;
        const newTask = {
            id: getNextId(),
            text,
            category: typeof category === 'number' ? category : parseInt(category) || 0,
            completed: false,
            active: true,
            statusChangedAt: Date.now()
        };
        if (selectedSub && typeof selectedSub === 'string' && selectedSub.trim()) {
            const norm = normalizeSubcategoryName(newTask.category, selectedSub);
            if (norm) newTask.subcategory = norm;
        }
        tasks.push(newTask);
    });
    saveTasks();
    // clear modal textarea if present
    if (modalTaskText) { modalTaskText.value = ''; setTimeout(() => modalTaskText.focus(), 30); }
    // keep add modal open to allow adding more tasks/subcategories
    // refresh UI
    displayTasks();
}

// Переменные состояния
let currentTask = null;
let timerInterval = null;
let timerTime = 15 * 60; // 15 мину в секундах
let timerRunning = false;
let selectedTaskId = null;
let activeDropdown = null;
let wakeLock = null; // экраны н�� засыают во время таймера (где поддержвается)

// Новые переменные для точного аймера
let timerStartTime = 0;
let timerPausedTime = 0;
let timerAnimationFrame = null;
let timerWorker = null;
let timerEndAt = 0;
let timerEndTimeoutId = null;
let timerSoundEnabled = true;

// ежим отображеия архива ыолненных задач
let showArchive = false;

// Элемнты DOM
const sections = document.querySelectorAll('.section');

// Глобальный обработчик для за��рыт��я откытого выпадащего меню категорий
document.addEventListener('click', function(e) {
    if (activeDropdown && !e.target.closest('.category-selector') && !e.target.closest('.add-category-selector')) {
        activeDropdown.classList.remove('show');
        if (activeDropdown.parentElement) activeDropdown.parentElement.style.zIndex = '';
        activeDropdown = null;
    }
});
const showTasksBtn = document.getElementById('showTasksBtn');
const addMultipleBtn = document.getElementById('addMultipleBtn');
const addSingleBtn = document.getElementById('addSingleBtn');
const archiveBtn = document.getElementById('archiveBtn');
const exportTasksBtn = document.getElementById('exportTasksBtn');
const taskList = document.getElementById('taskList');
const tasksContainer = document.getElementById('tasksContainer');
const taskText = document.getElementById('taskText');
const taskCategory = document.getElementById('taskCategory');
const addTaskBtn = document.getElementById('addTaskBtn');
const hideTasksBtn = document.getElementById('hideTasksBtn');
const timerScreen = document.getElementById('timerScreen');
const timerTaskText = document.getElementById('timerTaskText');
const timerDisplay = document.getElementById('timerDisplay');
const timerMinutes = document.getElementById('timerMinutes');
const startTimerBtn = document.getElementById('startTimerBtn');
const pauseTimerBtn = document.getElementById('pauseTimerBtn');
const resetTimerBtn = document.getElementById('resetTimerBtn');
const completeTaskBtn = document.getElementById('completeTaskBtn');
const returnTaskBtn = document.getElementById('returnTaskBtn');
const closeTimerBtn = document.getElementById('closeTimerBtn');
const soundToggleBtn = document.getElementById('soundToggleBtn');
const completeNowBtn = document.getElementById('completeNowBtn');
const importFile = document.getElementById('importFile');
const notification = document.getElementById('notification');
const timerCompleteOptions = document.getElementById('timerCompleteOptions');
const notifyBanner = document.getElementById('notifyBanner');
const enableNotifyBtn = document.getElementById('enableNotifyBtn');
const notifyToggleBtn = document.getElementById('notifyToggleBtn');

function applyCategoryVisualToSelect() {
    if (!taskCategory) return;
    const val = parseInt(taskCategory.value) || 0;
    const badge = document.querySelector('.add-category-badge');
    if (badge) {
        const label = getCategoryName(val);
        badge.textContent = label;
        badge.setAttribute('data-category', String(val));
    }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

async function ensurePushSubscribed() {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
        const keyRes = await fetch('/api/push/public-key');
        const { publicKey } = await keyRes.json();
        sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
    }
    await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
    return true;
}

function setNotifyBannerVisible(visible) {
    if (notifyBanner) notifyBanner.style.display = visible ? 'flex' : 'none';
}

function refreshNotifyBanner() {
    if (!('Notification' in window)) {
        setNotifyBannerVisible(false);
    }
}

function updateNotifyToggle() {
    if (!notifyToggleBtn || !('Notification' in window)) {
        if (notifyToggleBtn) notifyToggleBtn.style.display = 'none';
        return;
    }
    notifyToggleBtn.style.display = 'inline-flex';
    const icon = notifyToggleBtn.querySelector('i');
    if (Notification.permission === 'granted') {
        if (icon) icon.className = 'fas fa-bell';
    } else {
        if (icon) icon.className = 'fas fa-bell-slash';
    }
}

// Функция дя плучения названия категори�� по номеру
function getCategoryName(category) {
    const categories = {
        0: "Категория не определена",
        1: "Обязательные",
        2: "Безопасность",
        3: "Простые радости",
        4: "Эго-радости",
        5: "Доступность простых радостей"
    };
    return categories[category] || "Неизвестно";
}

// Escape HTML to avoid injection when inserting task text into innerHTML
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// Prevent single-letter words from being pushed to the next line by replacing the space before them with a non-breaking space
function fixOrphans(text) {
    if (!text) return '';
    // Prefer non-breaking space after single-letter prepositions: replace 'x ' where x is single letter with 'x\u00A0'
    // Handle both Latin and Cyrillic letters
    const afterSingleRegex = /(^|\s)([A-Za-zА-Яа-яЁё])\s+/g;
    let res = text.replace(afterSingleRegex, function(m, p1, p2) { return p1 + p2 + '\u00A0'; });
    // Also ensure that occurrences of ' space single-letter space ' are normalized (rare)
    const isolatedSingle = /\s([A-Za-zА-Яа-яЁё])\s/g;
    res = res.replace(isolatedSingle, function(m,p1){ return '\u00A0' + p1 + ' '; });
    return res;
}

// Функция отображения сех заач
function displayTasks() {
    tasksContainer.innerHTML = '';

    const titleEl = taskList.querySelector('h2');
    if (titleEl) titleEl.textContent = showArchive ? 'Выполненные' : 'Все задачи';

    // hide import/export controls when viewing archive
    const importExportEl = document.querySelector('.import-export');
    if (importExportEl) importExportEl.style.display = showArchive ? 'none' : 'flex';

    const isMobile = window.matchMedia('(max-width: 480px)').matches;
    tasksContainer.classList.remove('sticker-grid');
    tasksContainer.classList.toggle('mobile-compact', isMobile);

    const groups = new Map();
    const source = tasks.filter(t => showArchive ? t.completed : !t.completed);
    source.forEach(t => {
        const arr = groups.get(t.category) || [];
        arr.push(t);
        groups.set(t.category, arr);
    });

    const categories = Array.from(groups.keys()).sort((a, b) => a - b);

    const collapsedRaw = localStorage.getItem('collapsedCategories');
    const collapsedCategories = new Set(collapsedRaw ? JSON.parse(collapsedRaw) : []);

    // Загружаем сохранённе пользо��ательске подкатегории
    const customSubsRaw = localStorage.getItem('customSubcategories');
    const customSubs = customSubsRaw ? JSON.parse(customSubsRaw) : {};

    categories.forEach(cat => {
        const group = document.createElement('div');
        group.className = `category-group category-${cat}`;
        group.dataset.category = String(cat);

        const title = document.createElement('div');
        title.className = 'category-title';
        title.innerHTML = `<div class=\"category-title-left\"><i class=\"fas fa-folder folder-before-title\"></i><span class=\"category-heading\">${getCategoryName(cat)}</span></div><button type=\"button\" class=\"category-add-btn\" data-cat=\"${cat}\" title=\"Добавить задачу в катего��ию\"><i class=\"fas fa-plus\"></i></button>`;

        const grid = document.createElement('div');
        grid.className = 'group-grid';

        if (collapsedCategories.has(cat)) {
            group.classList.add('collapsed');
        }

        group.appendChild(title);
        group.appendChild(grid);
        tasksContainer.appendChild(group);

        // Клик по названию категории — сворачивание/развора��ивание гру��пы
        const headSpan = title.querySelector('.category-heading');
        if (headSpan) {
            headSpan.style.cursor = 'pointer';
            headSpan.addEventListener('click', (e) => {
                e.stopPropagation();
                const c = parseInt(group.dataset.category);
                if (group.classList.contains('collapsed')) {
                    group.classList.remove('collapsed');
                    collapsedCategories.delete(c);
                } else {
                    group.classList.add('collapsed');
                    collapsedCategories.add(c);
                }
                localStorage.setItem('collapsedCategories', JSON.stringify(Array.from(collapsedCategories)));
            });
        }

        // Клик по иконк папки — ворачивание/разворачивание
        const folderIcon = title.querySelector('.folder-before-title');
        if (folderIcon) {
            folderIcon.style.cursor = 'pointer';
            folderIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                const c = parseInt(group.dataset.category);
                if (group.classList.contains('collapsed')) {
                    group.classList.remove('collapsed');
                    collapsedCategories.delete(c);
                } else {
                    group.classList.add('collapsed');
                    collapsedCategories.add(c);
                }
                localStorage.setItem('collapsedCategories', JSON.stringify(Array.from(collapsedCategories)));
            });
        }

        const list = groups.get(cat) || [];
        list.sort((a, b) => {
            if (a.active !== b.active) return a.active ? -1 : 1;
            const ta = a.statusChangedAt || 0;
            const tb = b.statusChangedAt || 0;
            if (!a.active && !b.active) return tb - ta;
            if (ta !== tb) return ta - tb;
            return a.id - b.id;
        });


        list.forEach(task => {
            const taskElement = document.createElement('div');
            taskElement.className = `task category-${task.category} ${task.active ? '' : 'inactive'}`;
            taskElement.dataset.id = task.id;
            if (task.subcategory) {
                taskElement.dataset.subcategory = task.subcategory;
            }

            const categoryDisplay = `<i class=\"fas fa-folder\"></i><span class=\"category-name\">${getCategoryName(task.category)}</span>`;

            // sanitize raw text: remove replacement chars, soft-hyphens and zero-width spaces
            let raw = String(task.text || '');
            raw = raw.replace(/\uFFFD/g, '');
            // remove soft hyphens and common HTML soft-hyphen entities
            raw = raw.replace(/&shy;|&#173;|\u00AD/g, '');
            raw = raw.replace(/\u200B/g, '');
            // merge letters split by explicit newlines (e.g. 'Разобрат\nь' -> 'Ра��обрать')
            raw = raw.replace(/([A-Za-zА-Яа-яЁё])\s*[\r\n]+\s*([A-Za-zА-Яа-яЁё])/g, '$1$2');
            // Replace remaining explicit newlines with spaces (users may paste multi-line text)
            raw = raw.replace(/[\r\n]+/g, ' ');
            // collapse multiple spaces
            raw = raw.replace(/\s{2,}/g, ' ').trim();
            const safeText = escapeHtml(raw);
            const displayText = fixOrphans(safeText);
            taskElement.innerHTML = `
                <div class=\"task-content\">
                    <div class=\"task-text\">${displayText}</div>
                    <div class=\"category-selector\">
                        <div class=\"task-top-actions\">
                            <div class=\"category-badge\" data-id=\"${task.id}\">
                                ${categoryDisplay}
                                <i class=\"fas fa-caret-down\"></i>
                            </div>
                            <button class=\"task-control-btn complete-task-btn\" data-id=\"${task.id}\" title=\"Отметить выполненной\">
                                <i class=\"fas fa-check\"></i>
                            </button>
                        </div>
                        <div class=\"category-dropdown\" id=\"dropdown-${task.id}\">
                            <button class=\"category-option\" data-category=\"0\">��ез категори��</button>
                            <div class=\"category-option-group\">
                                <button class=\"category-option\" data-category=\"1\">Обязательные</button>
                                <div class=\"category-subrow\">
                                    <button class=\"category-option\" data-category=\"1\" data-subcategory=\"work\">Работа</button>
                                    <span class=\"category-divider\"></span>
                                    <button class=\"category-option\" data-category=\"1\" data-subcategory=\"home\">Дом</button>
                                </div>
                            </div>
                            <button class=\"category-option\" data-category=\"2\">Безопасность</button>
                            <button class=\"category-option\" data-category=\"5\">Доступность простых радостей</button>
                            <button class=\"category-option\" data-category=\"3\">Простые радости</button>
                            <button class=\"category-option\" data-category=\"4\">Эго-радости</button>
                        </div>
                    </div>
                </div>
                <div class=\"task-controls\">
                    <button class=\"task-control-btn toggle-active-btn\" data-id=\"${task.id}\">
                        <i class=\"fas ${task.active ? 'fa-eye-slash' : 'fa-eye'}\"></i>
                    </button>
                    <button class=\"task-control-btn delete-task-btn\" data-id=\"${task.id}\">
                        <i class=\"fas fa-trash\"></i>
                    </button>
                </div>
            `;
            // If task is completed, adjust UI: strike-through, remove edit controls, add return button
            if (task.completed) {
                taskElement.classList.add('completed');
                const ttxt = taskElement.querySelector('.task-text');
                if (ttxt) ttxt.style.textDecoration = 'line-through';
                // remove dropdown caret if present
                const caret = taskElement.querySelector('.category-badge .fa-caret-down');
                if (caret) caret.remove();
                // remove complete and toggle buttons
                const completeBtn = taskElement.querySelector('.complete-task-btn'); if (completeBtn) completeBtn.remove();
                const toggleBtn = taskElement.querySelector('.toggle-active-btn'); if (toggleBtn) toggleBtn.remove();
                // ensure delete button remains available for completed tasks and add return button
                const controls = taskElement.querySelector('.task-controls');
                if (controls) {
                    controls.innerHTML = '';
                    const del = document.createElement('button');
                    del.className = 'task-control-btn delete-task-btn';
                    del.dataset.id = String(task.id);
                    del.title = 'Удалить задачу';
                    del.innerHTML = '<i class="fas fa-trash"></i>';
                    controls.appendChild(del);

                    const ret = document.createElement('button');
                    ret.className = 'task-control-btn return-task-btn';
                    ret.dataset.id = String(task.id);
                    ret.title = 'Вернуть в актив��ые';
                    ret.innerHTML = '<i class="fas fa-undo"></i>';
                    controls.appendChild(ret);
                }
                // remove folder icon from category badge for completed tasks
                const folderIcon = taskElement.querySelector('.category-badge i.fa-folder');
                if (folderIcon) folderIcon.remove();
            }

            // Перес��авяем элменты для мобильного: папка се��ху спраа, ниже сразу глаз и ур��а
            const contentWrap = taskElement.querySelector('.task-content');
            if (contentWrap) {
                const txt = contentWrap.querySelector('.task-text');
                const sel = contentWrap.querySelector('.category-selector');
                if (isMobile && txt && sel && sel.nextElementSibling !== txt) {
                    contentWrap.insertBefore(sel, txt);
                }
                if (isMobile) {
                    const controls = taskElement.querySelector('.task-controls');
                    if (controls && txt) {
                        contentWrap.insertBefore(controls, txt);
                    }
                }
            }
            if (isMobile && task.text.length > 44) {
                taskElement.classList.add('sticker-wide');
            }
            grid.appendChild(taskElement);


            // If this task belongs to security-related categories (2 or 5), render subcategory selector in the dropdown
            if (!task.completed && task.category !== 0) {
                populateTaskSubcategoryDropdown(task);
            } else if (!task.completed) {
                // task.category === 0 -> leave full category selection (default HTML)
            }
        });

        // Д��намическая группировка задач по подкатегориям для текущей категории (учитываем сохранённые подкатегории)
        {
            const nodes = [...grid.querySelectorAll(':scope > .task')];
            const noneTasks = nodes.filter(el => !el.dataset.subcategory);
            const bySub = new Map();
            nodes.forEach(el => {
                const sub = el.dataset.subcategory || '';
                if (!sub) return;
                const arr = bySub.get(sub) || [];
                arr.push(el);
                bySub.set(sub, arr);
            });
            const frag = document.createDocumentFragment();
            noneTasks.forEach(el => frag.appendChild(el));
            const saved = Array.isArray(customSubs[cat]) ? customSubs[cat] : [];
            const subSet = new Set([...bySub.keys(), ...saved]);
            const subNames = Array.from(subSet).sort((a,b)=>a.localeCompare(b,'ru'));
            subNames.forEach(name => {
                const titleEl = document.createElement('div');
                titleEl.className = 'category-title';
                titleEl.innerHTML = `<span class=\"category-heading\">${escapeHtml(name)}</span>`;
                const leftWrap = document.createElement('div');
                leftWrap.className = 'subcategory-title-left';
                const headingSpan = titleEl.querySelector('.category-heading');
                if (headingSpan) leftWrap.appendChild(headingSpan);
                titleEl.appendChild(leftWrap);
                // Добавляем кнопку-глаз для массового скрытия/показа задач подкатегории только в категории "Обязательные"
                if (Number(cat) === 1 && !showArchive) {
                    const eyeBtn = document.createElement('button');
                    eyeBtn.className = 'task-control-btn subcategory-toggle-all';
                    eyeBtn.type = 'button';
                    eyeBtn.setAttribute('aria-label','Скрыть/показать все задачи подкатегории');
                    const hasActive = tasks.some(t => t.category === cat && t.subcategory === name && t.active && !t.completed);
                    eyeBtn.innerHTML = `<i class="fas ${hasActive ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
                    eyeBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleSubcategoryActiveByName(cat, name); });
                    leftWrap.appendChild(eyeBtn);
                }
                const menuBtn = document.createElement('button');
                menuBtn.className = 'subcategory-menu-btn';
                menuBtn.type = 'button';
                menuBtn.setAttribute('aria-label','Меню подкатегории');
                menuBtn.innerHTML = '<i class="fas fa-ellipsis-v"></i>';
                menuBtn.addEventListener('click', (e) => { e.stopPropagation(); openSubcategoryActions(cat, name); });
                titleEl.appendChild(menuBtn);
                frag.appendChild(titleEl);
                const arr = bySub.get(name) || [];
                arr.forEach(el => frag.appendChild(el));
            });
            grid.innerHTML = '';
            grid.appendChild(frag);
        }

        // Обработчик сворачивания перенесён на иконку папки выше
    });

    // After rendering groups, remove subcategory toggles inside security groups (category 2 and 5)
    document.querySelectorAll('.category-group').forEach(groupEl => {
        const catNum = parseInt(groupEl.dataset.category);
        if (catNum === 2 || catNum === 5) {
            groupEl.querySelectorAll('.subcategory-toggle-all').forEach(btn => btn.remove());
        }
    });

    // Добавяем обработчики событий для ноы�� элементов
    document.querySelectorAll('.category-badge').forEach(badge => {
        // category-name inside task badge should not prompt for subcategory anymore
        const nameEl = badge.querySelector('.category-name');
        if (nameEl) {
            nameEl.style.cursor = 'default';
        }
        badge.addEventListener('click', function(e) {
            e.stopPropagation();
            const id = parseInt(badge.getAttribute('data-id'));
            const idx = tasks.findIndex(t => t.id === id);
            if (idx !== -1 && tasks[idx].completed) return; // don't open dropdown for completed tasks
            const dropdown = this.closest('.category-selector').querySelector('.category-dropdown');
            if (activeDropdown && activeDropdown !== dropdown) {
                activeDropdown.classList.remove('show');
                if (activeDropdown.parentElement) activeDropdown.parentElement.style.zIndex = '';
            }
            /* dropdown is resolved above */
            dropdown.classList.toggle('show');
            activeDropdown = dropdown;
            if (dropdown.classList.contains('show')) {
                if (dropdown.parentElement) dropdown.parentElement.style.zIndex = '9000';
                dropdown.style.top = '100%';
                dropdown.style.bottom = 'auto';
                dropdown.style.left = '';
                dropdown.style.right = '';
                const rect = dropdown.getBoundingClientRect();
                const vw = window.innerWidth || document.documentElement.clientWidth;
                const vh = window.innerHeight || document.documentElement.clientHeight;
                if (rect.bottom > vh - 8) {
                    dropdown.style.top = 'auto';
                    dropdown.style.bottom = '100%';
                }
                if (rect.right > vw - 8) {
                    dropdown.style.left = 'auto';
                    dropdown.style.right = '0';
                }
                if (rect.left < 8) {
                    dropdown.style.left = '0';
                    dropdown.style.right = 'auto';
                }
            } else {
                if (dropdown.parentElement) dropdown.parentElement.style.zIndex = '';
            }
        });
    });

    document.querySelectorAll('.category-option').forEach(option => {
        // attach + button on category titles and task badges to open add modal
    });

    // attach handlers for category-add buttons (open modal restricted to this category)
    document.querySelectorAll('.category-add-btn').forEach(btn => {
        if (showArchive) {
            // hide add buttons when viewing completed tasks
            btn.style.display = 'none';
            return;
        }
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const cat = btn.dataset.cat ? parseInt(btn.dataset.cat) : null;
            openAddModal(undefined, { restrict: 'section', sectionCats: String(cat) });
        });
    });

    // continue with category-option bindings
    document.querySelectorAll('.category-option').forEach(option => {
        option.addEventListener('click', function() {
            const badge = this.closest('.category-selector').querySelector('.category-badge');
            const taskId = parseInt(badge.dataset.id);
            const idx = tasks.findIndex(t => t.id === taskId);
            if (idx !== -1 && tasks[idx].completed) {
                // don't allow changing category of completed tasks
                return;
            }
            const newCategory = parseInt(this.dataset.category);
            const newSub = null;
            changeTaskCategory(taskId, newCategory, newSub);
            // Закрываем dropdown
            const dd = this.closest('.category-dropdown');
            dd.classList.remove('show');
            if (dd && dd.parentElement) dd.parentElement.style.zIndex = '';
            activeDropdown = null;
        });
    });

    document.querySelectorAll('.toggle-active-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = parseInt(e.target.closest('.toggle-active-btn').dataset.id);
            toggleTaskActive(id);
        });
    });

    document.querySelectorAll('.delete-task-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = parseInt(e.target.closest('.delete-task-btn').dataset.id);
            deleteTask(id);
        });
    });

    document.querySelectorAll('.complete-task-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(e.currentTarget.dataset.id);
            const idx = tasks.findIndex(t => t.id === id);
            if (idx !== -1) {
                tasks[idx].completed = true;
                tasks[idx].active = false;
                tasks[idx].statusChangedAt = Date.now();
                saveTasks();
                displayTasks();
            }
        });
    });

    // Return completed task back to active
    document.querySelectorAll('.return-task-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(e.currentTarget.dataset.id);
            const idx = tasks.findIndex(t => t.id === id);
            if (idx !== -1) {
                tasks[idx].completed = false;
                tasks[idx].active = true;
                tasks[idx].statusChangedAt = Date.now();
                saveTasks();
                displayTasks();
            }
        });
    });

    document.querySelectorAll('.task-text').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const taskEl = el.closest('.task');
            if (!taskEl) return;
            const id = parseInt(taskEl.dataset.id);
            const orig = el.textContent || '';
            const input = document.createElement('textarea');
            input.className = 'task-edit';
            input.value = orig;
            el.style.display = 'none';
            el.insertAdjacentElement('afterend', input);
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
            const commit = () => {
                const val = input.value.trim();
                input.removeEventListener('keydown', onKey);
                input.removeEventListener('blur', onBlur);
                if (val && val !== orig) {
                    const idx = tasks.findIndex(t => t.id === id);
                    if (idx !== -1) {
                        tasks[idx].text = val;
                        saveTasks();
                        displayTasks();
                        return;
                    }
                }
                input.remove();
                el.style.display = '';
            };
            const cancel = () => {
                input.removeEventListener('keydown', onKey);
                input.removeEventListener('blur', onBlur);
                input.remove();
                el.style.display = '';
            };
            const onKey = (ev) => {
                if (ev.key === 'Enter' && !ev.shiftKey) {
                    ev.preventDefault();
                    commit();
                } else if (ev.key === 'Escape') {
                    ev.preventDefault();
                    cancel();
                }
            };
            const onBlur = () => commit();
            input.addEventListener('keydown', onKey);
            input.addEventListener('blur', onBlur);
        });
    });
}

// Функция для изеения кат��гории задачи
function changeTaskCategory(taskId, newCategory, newSubcategory = null) {
    const taskIndex = tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;
    const wasActive = !!tasks[taskIndex].active;

    const updateData = { category: newCategory };
    if (typeof newSubcategory === 'string' && newSubcategory.trim()) {
        updateData.subcategory = newSubcategory.trim();
    }
    if (tasks[taskIndex].category === 0 && !tasks[taskIndex].active && newCategory !== 0) {
        updateData.active = true;
    }
    if (!wasActive && updateData.active === true) {
        updateData.statusChangedAt = Date.now();
    }

    tasks[taskIndex] = { ...tasks[taskIndex], ...updateData };
    saveTasks();
    displayTasks();
}

// ункция для переключения активности задачи
function toggleTaskActive(taskId) {
    const taskIndex = tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;

    const newActive = !tasks[taskIndex].active;
    tasks[taskIndex].active = newActive;
    tasks[taskIndex].statusChangedAt = Date.now();

    saveTasks();
    displayTasks();
}

// Пееклю��ение активности всех задач внтри категории
function toggleCategoryActive(category) {
    const hasActive = tasks.some(t => t.category === category && t.active);
    const newActive = !hasActive;
    tasks = tasks.map(t => t.category === category ? { ...t, active: newActive, statusChangedAt: Date.now() } : t);
    saveTasks();
    displayTasks();
}

// Переклюение активности подкатегоии по им��ни для указанной категрии
function toggleSubcategoryActiveByName(category, subName) {
    const hasActive = tasks.some(t => t.category === category && t.subcategory === subName && t.active);
    const newActive = !hasActive;
    tasks = tasks.map(t => (t.category === category && t.subcategory === subName)
        ? { ...t, active: newActive, statusChangedAt: Date.now() }
        : t
    );
    saveTasks();
    displayTasks();
}

// Функця для удаления задачи
function deleteTask(taskId) {
    openConfirmModal({
        title: 'Удаление задачи',
        message: 'Удалить эту зад��чу?',
        confirmText: 'Удалить',
        cancelText: 'Отмена',
        requireCheck: true,
        checkboxLabel: 'Подтверждаю удаление',
        onConfirm: () => {
            tasks = tasks.filter(t => t.id !== taskId);
            saveTasks();
            displayTasks();
        }
    });
}

// Ф��нкия для экспорта задач в фйл
function exportTasks() {
    const dataStr = JSON.stringify(tasks, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = 'к��робочка-задачи.json';
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
}

// Функция дл импорта задач из файла
function importTasks(file) {
    const reader = new FileReader();
    
    reader.onload = function(e) {
        try {
            const importedTasks = JSON.parse(e.target.result);
            
            if (!Array.isArray(importedTasks)) {
                openInfoModal('Ошибка: файл должен содержать мас��и�� задач');
                return;
            }
            
            // Проверяем структуру задач
            for (const task of importedTasks) {
                if (!task.text || typeof task.category === 'undefined') {
                    openInfoModal('Ошибка: не��равильный формат ��айла');
                    return;
                }
            }
            
            // Добавлям задачи в бзу данных
            tasks = importedTasks;
            saveTasks();
            openInfoModal(`Успешно импортировано ${importedTasks.length} задач`, 'Импорт завершён');
            displayTasks();
            
        } catch (error) {
            openInfoModal('Ошибка при чтении файла: ' + error.message);
        }
    };
    
    reader.readAsText(file);
}

// Функция для выбора случайной адачи из категории
function getRandomTask(categories) {
    // Преоразуем строку категорий в масив чисел
    const categoryArray = categories.split(',').map(Number);
    
    // Получаем все активные задачи из указанных категорий
    const filteredTasks = tasks.filter(task => 
        categoryArray.includes(task.category) && task.active
    );
    
    if (filteredTasks.length === 0) {
        openInfoModal('Нет активных задач в этой категории!');
        return null;
    }
    
    const randomIndex = Math.floor(Math.random() * filteredTasks.length);
    return filteredTasks[randomIndex];
}

// Функция для отобажения таймера
function showTimer(task) {
    currentTask = task;
    timerTaskText.textContent = task.text;
    try { timerTaskText.style.backgroundColor = getCategoryColor(task.category); } catch (e) {}

    // по умолчанию при новом таймере звук включён
    timerSoundEnabled = true;
    updateSoundToggleUI();
    updateTimerControlsForViewport();

    // Полный сбос состояния таймера перед новым ��апуском
    if (timerEndTimeoutId) {
        clearTimeout(timerEndTimeoutId);
        timerEndTimeoutId = null;
    }
    timerRunning = false;
    timerPausedTime = 0;
    timerEndAt = 0;

    timerTime = Math.max(1, parseInt(timerMinutes.value)) * 60;
    updateTimerDisplay();
    timerScreen.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Скрывае�� опции завершения и показыва��м управлени аймером
    timerCompleteOptions.style.display = 'none';
    document.querySelector('.timer-controls').style.display = 'flex';
}

function updateSoundToggleUI() {
    if (!soundToggleBtn) return;
    soundToggleBtn.setAttribute('aria-pressed', String(timerSoundEnabled));
    soundToggleBtn.title = timerSoundEnabled ? 'Звук включён' : 'Звук выключен';
    soundToggleBtn.setAttribute('aria-label', timerSoundEnabled ? 'Звук включён' : 'Звук выключен');
    soundToggleBtn.innerHTML = timerSoundEnabled ? '<i class="fas fa-volume-up"></i>' : '<i class="fas fa-volume-xmark"></i>';
    if (timerSoundEnabled) {
        soundToggleBtn.classList.remove('is-muted');
    } else {
        soundToggleBtn.classList.add('is-muted');
    }
}

if (soundToggleBtn) {
    soundToggleBtn.addEventListener('click', () => {
        timerSoundEnabled = !timerSoundEnabled;
        updateSoundToggleUI();
    });
}

function updateTimerControlsForViewport() {
    const isMobile = window.matchMedia('(max-width: 480px)').matches;
    if (!startTimerBtn || !pauseTimerBtn || !resetTimerBtn) return;
    if (isMobile) {
        startTimerBtn.classList.add('icon-only');
        pauseTimerBtn.classList.add('icon-only');
        resetTimerBtn.classList.add('icon-only');
        startTimerBtn.innerHTML = '<i class="fas fa-play"></i>';
        startTimerBtn.setAttribute('aria-label','Старт');
        startTimerBtn.title = 'Старт';
        pauseTimerBtn.innerHTML = '<i class="fas fa-pause"></i>';
        pauseTimerBtn.setAttribute('aria-label','Пауза');
        pauseTimerBtn.title = 'Пауза';
        resetTimerBtn.innerHTML = '<i class="fas fa-rotate-left"></i>';
        resetTimerBtn.setAttribute('aria-label','Сброс');
        resetTimerBtn.title = 'Сброс';
    } else {
        startTimerBtn.classList.remove('icon-only');
        pauseTimerBtn.classList.remove('icon-only');
        resetTimerBtn.classList.remove('icon-only');
        startTimerBtn.textContent = 'Старт';
        pauseTimerBtn.textContent = 'Пауза';
        resetTimerBtn.textContent = 'Сброс';
    }
}

window.addEventListener('resize', updateTimerControlsForViewport);

// Функция для скрытия таймера
function hideTimer() {
    timerScreen.style.display = 'none';
    document.body.style.overflow = 'auto'; // Восстанавливам прокрутку
    stopTimer(); // Останавливем таймр при закр��ти
    releaseWakeLock();
}

// Функция для обновления оображения таймера
function updateTimerDisplay() {
    const minutes = Math.floor(timerTime / 60);
    const seconds = timerTime % 60;
    timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Функция для показа уведо��ления
function showNotification(message) {
    const body = message || (currentTask ? `Задача: ${currentTask.text}` : "Вр��мя вышло! Зад��ча завершена.");
    showToastNotification("🎁 КОРОБОЧКА", body, 5000);
    playBeep();

    if ("Notification" in window) {
        if (Notification.permission === "granted") {
            createBrowserNotification(body);
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then(permission => {
                if (permission === "granted") {
                    createBrowserNotification(body);
                }
            });
        }
    }
}

// Сздани браузерного уведомления
function createBrowserNotification(message) {
    const title = "🎁 КОРОБОЧКА";
    const options = {
        body: message || "Время ышло! адача завершена.",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        vibrate: [500, 300, 500],
        tag: "timer-notification",
        renotify: true,
        requireInteraction: true,
        data: { url: "/" }
    };

    if (!("Notification" in window)) return;

    if (navigator.serviceWorker && Notification.permission === "granted") {
        navigator.serviceWorker.ready
            .then(reg => {
                if (reg && reg.showNotification) {
                    reg.showNotification(title, options);
                } else {
                    new Notification(title, options);
                }
            })
            .catch(() => {
                new Notification(title, options);
            });
    } else if (Notification.permission === "granted") {
        new Notification(title, options);
    }
}

// Добавляем запрос разрешения при загрузке страницы
function populateTaskSubcategoryDropdown(task) {
    const dd = document.getElementById(`dropdown-${task.id}`);
    if (!dd) return;
    dd.innerHTML = '';
    // Apply category-colored background for the dropdown
    try { dd.style.backgroundColor = lightenHex(getCategoryColor(task.category), 0.92); dd.style.color = '#222'; } catch (e) {}
    // option: none
    const noneBtn = document.createElement('button');
    noneBtn.type = 'button';
    noneBtn.className = 'category-option';
    noneBtn.textContent = 'Без подкатег��рии';
    noneBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        changeTaskCategory(task.id, task.category, null);
        dd.classList.remove('show');
        activeDropdown = null;
    });
    dd.appendChild(noneBtn);

    // gather subcategories: defaults + saved
    const customSubsRaw = localStorage.getItem('customSubcategories');
    const customSubs = customSubsRaw ? JSON.parse(customSubsRaw) : {};
    const list = [];
    const present = new Set();
    if (String(task.category) === '1') { list.push({ key: 'work', label: 'Работа' }); present.add('work'); list.push({ key: 'home', label: 'Дом' }); present.add('home'); }
    const saved = Array.isArray(customSubs[task.category]) ? customSubs[task.category] : [];
    saved.forEach(s => {
        const norm = normalizeSubcategoryName(task.category, s);
        if (String(task.category) === '1' && (norm === 'home' || norm === 'work')) return;
        const tag = (norm || s).toLowerCase();
        if (!present.has(tag)) { present.add(tag); list.push({ key: s, label: s }); }
    });

    list.forEach(item => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'category-option';
        b.dataset.sub = normalizeSubcategoryName(task.category, item.key) || item.key;
        b.textContent = getSubcategoryLabel(task.category, item.label);
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            changeTaskCategory(task.id, task.category, b.dataset.sub);
            dd.classList.remove('show');
            activeDropdown = null;
        });
        dd.appendChild(b);
    });

    // for security category (2) provide add-button
    if ([2,3,4,5].includes(task.category)) {
        const wrapper = document.createElement('div');
        wrapper.className = 'category-option add-sub-btn-wrapper';
        const inline = document.createElement('div');
        inline.className = 'inline-add-form';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = (task.category === 2) ? 'новая сфера безопасности' : (task.category === 5) ? 'Новая сложная радость' : ((task.category === 3 || task.category === 4) ? 'новая сфера удовольствия' : 'Новая подкатегория');
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'inline-save-btn';
        save.textContent = 'Добавить';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'inline-cancel-btn';
        cancel.textContent = 'Отм��на';
        inline.appendChild(input);
        inline.appendChild(save);
        inline.appendChild(cancel);
        wrapper.appendChild(inline);
        dd.appendChild(wrapper);

        save.addEventListener('click', (e) => {
            e.stopPropagation();
            const name = input.value && input.value.trim();
            if (!name) return;
            const val = name;
            const arr = Array.isArray(customSubs[task.category]) ? customSubs[task.category] : [];
            if (!arr.includes(val)) arr.push(val);
            customSubs[task.category] = arr;
            localStorage.setItem('customSubcategories', JSON.stringify(customSubs));
            populateTaskSubcategoryDropdown(task);
            if (addTaskModal && addTaskModal.style.display === 'flex') showAddSubcategoriesFor(task.category, modalSubcategories);
        });
        cancel.addEventListener('click', (e) => { e.stopPropagation(); populateTaskSubcategoryDropdown(task); });
    }
}

function setupAddCategorySelector() {
    if (!taskCategory) return;
    let container = document.querySelector('.add-category-selector');
    if (!container) {
        container = document.createElement('div');
        container.className = 'add-category-selector';
        const badge = document.createElement('div');
        badge.className = 'add-category-badge';
        const dropdown = document.createElement('div');
        dropdown.className = 'add-category-dropdown';
        dropdown.innerHTML = `
            <button class="add-category-option" data-category="0">Категория не определена</button>
            <button class="add-category-option" data-category="1">Обязательные</button>
            <button class="add-category-option" data-category="2">Безопасн����сть</button>
            <button class="add-category-option" data-category="5">Доступность простых радостей</button>
            <button class="add-category-option" data-category="3">Прос��ые радости</button>
            <button class="add-category-option" data-category="4">Эго-радости</button>
        `;
        dropdown.querySelectorAll('.add-category-option').forEach(btn => {
            btn.addEventListener('click', () => {
                const v = btn.getAttribute('data-category') || '0';
                taskCategory.value = v;
                applyCategoryVisualToSelect();
                dropdown.classList.remove('show');
                activeDropdown = null;
                // show subcategory picker if available
                showAddSubcategoriesFor(parseInt(v));
            });
        });
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            if (activeDropdown && activeDropdown !== dropdown) {
                activeDropdown.classList.remove('show');
            }
            dropdown.classList.toggle('show');
            activeDropdown = dropdown;
        });
        container.appendChild(badge);
        container.appendChild(dropdown);
        taskCategory.insertAdjacentElement('afterend', container);
    }
    applyCategoryVisualToSelect();

    // Ensure subcategory controls container exists
    if (!document.querySelector('.add-subcategory-controls')) {
        const sc = document.createElement('div');
        sc.className = 'add-subcategory-controls';
        sc.style.display = 'none';
        taskCategory.parentElement.appendChild(sc);
    }
}

function showAddSubcategoriesFor(cat, targetContainer = null) {
    const controls = targetContainer || document.querySelector('.add-subcategory-controls');
    if (!controls) return;
    const customSubsRaw = localStorage.getItem('customSubcategories');
    const customSubs = customSubsRaw ? JSON.parse(customSubsRaw) : {};
    const list = [];
    const present = new Set();
    if (String(cat) === '1') {
        list.push({ key: 'work', label: 'Работа' }); present.add('work');
        list.push({ key: 'home', label: 'Дом' }); present.add('home');
    }
    const saved = Array.isArray(customSubs[cat]) ? customSubs[cat] : [];
    saved.forEach(s => {
        const norm = normalizeSubcategoryName(cat, s);
        if (String(cat) === '1' && (norm === 'home' || norm === 'work')) return;
        const tag = (norm || s).toLowerCase();
        if (!present.has(tag)) { present.add(tag); list.push({ key: s, label: s }); }
    });

    controls.innerHTML = '';

    // option for none
    const noneBtn = document.createElement('button');
    noneBtn.className = 'add-subcategory-btn modal-subcat-btn modal-btn cat-' + String(cat);
    noneBtn.type = 'button';
    noneBtn.dataset.sub = '';
    noneBtn.textContent = 'Без подкатего��ии';
    noneBtn.addEventListener('click', () => {
        controls.querySelectorAll('.add-subcategory-btn').forEach(x => x.classList.remove('selected'));
        noneBtn.classList.add('selected');
        const badge = document.querySelector('.add-category-badge'); if (badge) badge.setAttribute('data-sub', '');
    });
    controls.appendChild(noneBtn);

    list.forEach(item => {
        const b = document.createElement('button');
        b.className = 'add-subcategory-btn modal-subcat-btn modal-btn cat-' + String(cat);
        b.type = 'button';
        b.dataset.sub = normalizeSubcategoryName(cat, item.key) || item.key;
        b.textContent = getSubcategoryLabel(cat, item.label);
        b.addEventListener('click', () => {
            controls.querySelectorAll('.add-subcategory-btn').forEach(x => x.classList.remove('selected'));
            b.classList.add('selected');
            const badge = document.querySelector('.add-category-badge'); if (badge) badge.setAttribute('data-sub', b.dataset.sub);
        });
        controls.appendChild(b);
    });

    // inline add form instead of prompt
    const addWrapper = document.createElement('div');
    addWrapper.className = 'add-subcategory-btn add-subcategory-add';
    const inline = document.createElement('div');
    inline.className = 'inline-add-form';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = (String(cat) === '2') ? 'новая сфера безопасности' : (String(cat) === '5' ? 'Новая сложная радость' : ((String(cat) === '3' || String(cat) === '4') ? 'новая сфера удовольствия' : 'Новая подкатегория'));
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'inline-save-btn modal-btn modal-subcat-btn cat-' + String(cat);
    saveBtn.textContent = 'Добавить';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'inline-cancel-btn modal-btn modal-subcat-btn cat-' + String(cat);
    cancelBtn.textContent = 'Отмена';
    // wrap buttons into action row so we can align left/right
    const actionsRow = document.createElement('div');
    actionsRow.className = 'inline-add-actions';
    actionsRow.appendChild(saveBtn);
    actionsRow.appendChild(cancelBtn);
    inline.appendChild(inp);
    inline.appendChild(actionsRow);
    addWrapper.appendChild(inline);
    controls.appendChild(addWrapper);

    saveBtn.addEventListener('click', () => {
        const name = inp.value && inp.value.trim();
        if (!name) return;
        const val = name;
        const arrSaved = Array.isArray(customSubs[cat]) ? customSubs[cat] : [];
        if (!arrSaved.includes(val)) arrSaved.push(val);
        customSubs[cat] = arrSaved;
        localStorage.setItem('customSubcategories', JSON.stringify(customSubs));
        showAddSubcategoriesFor(cat, targetContainer);
        if (addTaskModal && addTaskModal.style.display === 'flex') {
            showAddSubcategoriesFor(cat, modalSubcategories);
        }
    });
    cancelBtn.addEventListener('click', () => { showAddSubcategoriesFor(cat, targetContainer); });

    controls.classList.add('show');
    controls.style.display = 'flex';
}

window.addEventListener('load', async () => {
    loadTasks();

    setupAddCategorySelector();

    if (typeof addMultipleBtn !== 'undefined' && addMultipleBtn) {
        addMultipleBtn.style.display = 'none';
    }

    applyCategoryVisualToSelect();
    updateNotifyToggle();

    if (navigator.permissions && navigator.permissions.query) {
        try {
            const status = await navigator.permissions.query({ name: 'notifications' });
            const update = () => updateNotifyToggle();
            update();
            status.onchange = update;
        } catch (e) {}
    }

    if (!navigator.vibrate) {
        console.log("Вибраци не поддерживается на это�� устройстве");
    }
});

// НОВАЯ РЕАЛИЗАЦИЯ ТАЙЕРА (точный и работающий в фоне)

// Поддержка Wake Lock API, чтобы экран не засыпа�� во врея таймера
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator && !wakeLock) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => {
                wakeLock = null;
            });
        }
    } catch (_) {
        // игнорируем ошибки
    }
}

async function releaseWakeLock() {
    try {
        if (wakeLock) {
            await wakeLock.release();
            wakeLock = null;
        }
    } catch (_) {}
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && timerRunning) {
        requestWakeLock();
    }
});

// З��уковой сигнал по завершении
function playBeep() {
    if (!timerSoundEnabled) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(880, ctx.currentTime);
        g.gain.setValueAtTime(0.001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
        o.connect(g).connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.6);
    } catch (_) {}
}

// Функция для запуска таймера
function startTimer() {
    if (timerRunning) return;
    requestWakeLock();

    timerRunning = true;
    // при возобновлении с паузы
    if (timerPausedTime > 0) {
        timerEndAt = Date.now() + (timerPausedTime * 1000);
        timerPausedTime = 0;
    }
    // при перво зауске
    if (!timerEndAt) {
        const total = Math.max(1, parseInt(timerMinutes.value)) * 60;
        timerEndAt = Date.now() + total * 1000;
    }
    timerStartTime = Date.now();

    // Сообщае серверу о распсании пуш-уведомления
    try {
        ensurePushSubscribed().then(() => {
            fetch('/api/timer/schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endAt: timerEndAt, taskText: currentTask ? currentTask.text : '' })
            }).catch(() => {});
        }).catch(() => {});
    } catch (_) {}

    // ланируем локальный fallback
    if (timerEndTimeoutId) clearTimeout(timerEndTimeoutId);
    const delay = Math.max(0, timerEndAt - Date.now());
    timerEndTimeoutId = setTimeout(() => {
        if (!timerRunning) return;
        const msg = currentTask ? `Задача: ${currentTask.text}` : undefined;
        stopTimer();
        showNotification(msg);
        timerCompleteOptions.style.display = 'flex';
        const controls = document.querySelector('.timer-controls');
        if (controls) controls.style.display = 'none';
    }, delay);
    
    // Использем Web Worker для тчного отсета времени в фоне
    if (typeof(Worker) !== "undefined") {
        if (timerWorker === null) {
            timerWorker = new Worker(URL.createObjectURL(new Blob([`
                let interval;
                self.onmessage = function(e) {
                    if (e.data === 'start') {
                        interval = setInterval(() => {
                            self.postMessage('tick');
                        }, 1000);
                    } else if (e.data === 'stop') {
                        clearInterval(interval);
                    }
                };
            `], {type: 'application/javascript'})));
            
            timerWorker.onmessage = function(e) {
                if (e.data === 'tick') {
                    timerTime = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
                    updateTimerDisplay();

                    if (timerTime <= 0) {
                        stopTimer();
                        showNotification(currentTask ? `Задача: ${currentTask.text}` : undefined);
                        timerCompleteOptions.style.display = 'flex';
                        document.querySelector('.timer-controls').style.display = 'none';
                    }
                }
            };
        }
        timerWorker.postMessage('start');
    } else {
        // Fallback дл браузеров без поддежки Web Workers
        timerInterval = setInterval(() => {
            timerTime = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
            updateTimerDisplay();

            if (timerTime <= 0) {
                stopTimer();
                showNotification(currentTask ? `Заача: ${currentTask.text}` : undefined);
                timerCompleteOptions.style.display = 'flex';
                document.querySelector('.timer-controls').style.display = 'none';
            }
        }, 1000);
    }
}

// Функция для аузы тайм��а
function pauseTimer() {
    if (!timerRunning) return;

    stopTimer();
    if (timerEndTimeoutId) {
        clearTimeout(timerEndTimeoutId);
        timerEndTimeoutId = null;
    }
    timerPausedTime = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
}

// Функция для остановки таймра
function stopTimer() {
    timerRunning = false;
    releaseWakeLock();

    if (timerEndTimeoutId) {
        clearTimeout(timerEndTimeoutId);
        timerEndTimeoutId = null;
    }

    if (timerWorker) {
        timerWorker.postMessage('stop');
    } else {
        clearInterval(timerInterval);
    }
    
    if (timerAnimationFrame) {
        cancelAnimationFrame(timerAnimationFrame);
        timerAnimationFrame = null;
    }
}

async function cancelServerSchedule() {
    try {
        if (timerEndAt > 0) {
            await fetch('/api/timer/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endAt: timerEndAt })
            });
        }
    } catch (_) {}
}

// Ф��нкци для сброса тайме��а
function resetTimer() {
    // отменяе тольк локальный таймр, серверый не тргаем, чтобы пауза/сброс ��ы�� явным
    stopTimer();
    if (timerEndTimeoutId) {
        clearTimeout(timerEndTimeoutId);
        timerEndTimeoutId = null;
    }
    timerEndAt = 0;
    timerTime = Math.max(1, parseInt(timerMinutes.value)) * 60;
    timerPausedTime = 0;
    updateTimerDisplay();
}

// Обраотчки обытий
sections.forEach(section => {
    section.addEventListener('click', () => {
        const categories = section.dataset.category;
        const task = getRandomTask(categories);
        if (task) showTimer(task);
    });
    const rnd = section.querySelector('.section-random-btn');
    if (rnd) rnd.addEventListener('click', (e) => {
        e.stopPropagation();
        const categories = section.dataset.category;
        const task = getRandomTask(categories);
        if (task) showTimer(task);
    });
    const add = section.querySelector('.section-add-btn');
    if (add) add.addEventListener('click', (e) => {
        e.stopPropagation();
        showArchive = false;
        // open modal restricted to this section: only show "Без катгоии" or subcategories for this section
        openAddModal(undefined, { restrict: 'section', sectionCats: section.dataset.category });
    });
});



showTasksBtn.addEventListener('click', () => {
    showArchive = false;
    taskList.style.display = 'block';
    displayTasks();
    showAddSubcategoriesFor(parseInt(taskCategory.value));
});

if (archiveBtn) {
    archiveBtn.addEventListener('click', () => {
        showArchive = true;
        taskList.style.display = 'block';
        displayTasks();
        const sc = document.querySelector('.add-subcategory-controls'); if (sc) { sc.classList.remove('show'); sc.style.display = 'none'; }
    });
}

hideTasksBtn.addEventListener('click', () => {
    taskList.style.display = 'none';
});

taskCategory.addEventListener('change', applyCategoryVisualToSelect);

addTaskBtn.addEventListener('click', (e) => { e.preventDefault(); openAddModal(parseInt(taskCategory.value) || 0); });

// Modal elements
const addTaskModal = document.getElementById('addTaskModal');
const modalBackdrop = document.getElementById('modalBackdrop');
const modalTaskText = document.getElementById('modalTaskText');
const modalCategoryOptions = document.getElementById('modalCategoryOptions');
const modalSubcategories = document.getElementById('modalSubcategories');
const modalAddTaskBtn = document.getElementById('modalAddTaskBtn');
const modalCancelBtn = document.getElementById('modalCancelBtn');
const modalCloseBtn = document.getElementById('modalCloseBtn');

function getCategoryColor(cat) {
    switch (Number(cat)) {
        case 0: return '#f5f5f5';
        case 1: return '#fff9c4';
        case 2: return '#bbdefb';
        case 3: return '#c8e6c9';
        case 4: return '#ffcdd2';
        case 5: return '#d1c4e9';
        default: return '#ffffff';
    }
}

// Lighten hex color towards white by factor (0..1) where 1 keeps original, 0 -> white
function lightenHex(hex, factor) {
    try {
        if (!hex) return hex;
        const h = hex.replace('#','');
        const r = parseInt(h.substring(0,2),16);
        const g = parseInt(h.substring(2,4),16);
        const b = parseInt(h.substring(4,6),16);
        const nr = Math.round(r + (255 - r) * (1 - factor));
        const ng = Math.round(g + (255 - g) * (1 - factor));
        const nb = Math.round(b + (255 - b) * (1 - factor));
        return `rgb(${nr}, ${ng}, ${nb})`;
    } catch (e) { return hex; }
}

function getCategoryGroupBg(cat) {
    switch (Number(cat)) {
        case 0: return '#fafafa';
        case 1: return '#fffde7';
        case 2: return '#e3f2fd';
        case 3: return '#e8f5e9';
        case 4: return '#ffebee';
        case 5: return '#ede7f6';
        default: return '#ffffff';
    }
}

function applyModalBackground(cat) {
    const modalContent = addTaskModal ? addTaskModal.querySelector('.modal-content') : null;
    if (!modalContent) return;
    // use category group background (lighter) instead of sticker color
    const color = getCategoryGroupBg(cat);
    modalContent.style.backgroundColor = color;
    // ensure readable text color
    modalContent.style.color = '#333';
    // style modal buttons according to category
    applyModalButtonStyles(cat);
}

function applyModalButtonStyles(cat) {
    const addBtn = document.getElementById('modalAddTaskBtn');
    const cancelBtn = document.getElementById('modalCancelBtn');
    if (!addBtn || !cancelBtn) return;
    // remove existing category classes
    addBtn.className = addBtn.className.split(' ').filter(c => !c.startsWith('cat-')).join(' ').trim();
    cancelBtn.className = cancelBtn.className.split(' ').filter(c => !c.startsWith('cat-')).join(' ').trim();
    // ensure base class
    if (!addBtn.classList.contains('modal-btn')) addBtn.classList.add('modal-btn');
    if (!cancelBtn.classList.contains('modal-btn')) cancelBtn.classList.add('modal-btn');
    // apply category class
    addBtn.classList.add(`cat-${cat}`);
    // cancel is a secondary variant: use cat-{cat}-alt if desired, but for simplicity use same with muted style
    cancelBtn.classList.add(`cat-${cat}`);
}

function renderModalCategoryOptions(allowedCategories = null) {
    const container = modalCategoryOptions;
    if (!container) return;
    container.innerHTML = '';
    const cats = [0,1,2,5,3,4];
    const labels = {0: 'Категория не определена',1: 'Обязательные',2: 'Система безопасности',3: 'Простые радости',4: 'Эг��-радос��и',5: 'Доступность простых радостей'};
    cats.forEach(c => {
        if (allowedCategories && !allowedCategories.map(String).includes(String(c))) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `modal-category-btn cat-${c}`;
        btn.dataset.category = String(c);
        btn.textContent = labels[c] || String(c);
        btn.addEventListener('click', () => {
            container.querySelectorAll('.modal-category-btn').forEach(x => x.classList.remove('selected'));
            btn.classList.add('selected');
            applyModalBackground(btn.dataset.category);
            // show subcategory controls for any category that supports them
            showAddSubcategoriesFor(parseInt(btn.dataset.category), modalSubcategories);
            container.dataset.selected = btn.dataset.category;
        });
        container.appendChild(btn);
    });
}

// Modal helper functions
function openConfirmModal({ title='Подтверждени��', message='', confirmText='Ок', cancelText='Отмена', requireCheck=false, checkboxLabel='Подтверждаю действие', hideCancel=false, onConfirm=null }) {
    const m = document.getElementById('confirmModal'); if (!m) return;
    const backdrop = document.getElementById('confirmBackdrop');
    m.setAttribute('aria-hidden','false'); m.style.display = 'flex';
    const titleEl = m.querySelector('#confirmTitle'); const msgEl = m.querySelector('#confirmMessage');
    const wrap = m.querySelector('#confirmCheckWrap'); const chk = m.querySelector('#confirmCheckbox'); const chkLabel = m.querySelector('#confirmCheckboxLabel');
    const okBtn = m.querySelector('#confirmOkBtn'); const cancelBtn = m.querySelector('#confirmCancelBtn'); const closeBtn = m.querySelector('#confirmCloseBtn');
    if (titleEl) titleEl.textContent = title || '';
    if (msgEl) msgEl.textContent = message || '';
    if (chkLabel) chkLabel.textContent = checkboxLabel || '';
    if (wrap) wrap.style.display = requireCheck ? 'flex' : 'none';
    if (chk) chk.checked = false;
    okBtn.disabled = !!requireCheck;
    const onChange = () => { okBtn.disabled = requireCheck && !chk.checked; };
    if (chk) chk.addEventListener('change', onChange);
    const cleanup = () => {
        if (chk) chk.removeEventListener('change', onChange);
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onClose);
        closeBtn.removeEventListener('click', onClose);
        backdrop.removeEventListener('click', onClose);
        m.setAttribute('aria-hidden','true'); m.style.display = 'none';
    };
    const onClose = () => { cleanup(); };
    const onOk = () => { if (typeof onConfirm === 'function') onConfirm(); cleanup(); };
    okBtn.textContent = confirmText || 'Ок'; cancelBtn.textContent = cancelText || 'Отмена';
    cancelBtn.style.display = hideCancel ? 'none' : 'inline-flex';
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onClose);
    closeBtn.addEventListener('click', onClose);
    backdrop.addEventListener('click', onClose);
}
function openInfoModal(message, title='Сообщение') { openConfirmModal({ title, message, confirmText: 'Ок', hideCancel: true }); }

function renderCategoryButtons(container, allowed=null) {
    if (!container) return;
    container.innerHTML = '';
    const cats = [0,1,2,5,3,4];
    const labels = {0: 'Категория не определена',1: 'Обязательные',2: 'Система безопасности',3: 'Простые радости',4: 'Эго-радости',5: 'Доступность простых радостей'};
    cats.forEach(c => {
        if (allowed && !allowed.map(String).includes(String(c))) return;
        const btn = document.createElement('button'); btn.type='button'; btn.className=`modal-category-btn cat-${c}`; btn.dataset.category=String(c); btn.textContent = labels[c] || String(c);
        btn.addEventListener('click', () => {
            container.querySelectorAll('.modal-category-btn').forEach(x=>x.classList.remove('selected'));
            btn.classList.add('selected');
            // when used in move modal, show relevant subcategories
            const subCont = document.getElementById('moveSubcategories'); if (subCont) showAddSubcategoriesFor(parseInt(btn.dataset.category), subCont);
        });
        container.appendChild(btn);
    });
}

let currentSubcatContext = null;
function openSubcategoryActions(category, subName) {
    currentSubcatContext = { category: parseInt(category), subName };
    const m = document.getElementById('subcatActionsModal'); if (!m) return;
    m.setAttribute('aria-hidden','false'); m.style.display='flex';
}

// Setup subcategory actions modal behavior: rename, move, delete
(function setupSubcatActions(){
    const m = document.getElementById('subcatActionsModal'); if (!m) return;
    const close = () => { m.setAttribute('aria-hidden','true'); m.style.display='none'; };
    const closeBtn = document.getElementById('subcatActionsClose'); const cancelBtn = document.getElementById('subcatActionsCancel'); const backdrop = document.getElementById('subcatActionsBackdrop');
    [closeBtn,cancelBtn,backdrop].forEach(el => el && el.addEventListener('click', close));

    const renameOk = document.getElementById('renameSubcatOk'); const renameCancel = document.getElementById('renameSubcatCancel'); const renameClose = document.getElementById('renameSubcatClose');
    const renameModal = document.getElementById('renameSubcatModal'); const renameInput = document.getElementById('renameSubcatInput');
    if (renameOk) {
        renameOk.addEventListener('click', () => {
            const ctx = currentSubcatContext; if (!ctx) return; const newName = (renameInput.value||'').trim(); if (!newName) return;
            // update customSubcategories and tasks
            const raw = localStorage.getItem('customSubcategories'); const cs = raw?JSON.parse(raw):{}; const arr = Array.isArray(cs[ctx.category])?cs[ctx.category].slice():[];
            const idx = arr.indexOf(ctx.subName);
            if (idx !== -1) arr[idx] = newName; else if (!arr.includes(newName)) arr.push(newName);
            cs[ctx.category] = Array.from(new Set(arr)); localStorage.setItem('customSubcategories', JSON.stringify(cs));
            tasks = tasks.map(t => (t.category === ctx.category && t.subcategory === ctx.subName) ? ({...t, subcategory: newName}) : t);
            saveTasks();
            displayTasks();
            try {
                if (addTaskModal && addTaskModal.style.display === 'flex') {
                    let selCat = null;
                    if (typeof modalPrimaryCategory === 'number' && modalPrimaryCategory !== null) selCat = modalPrimaryCategory;
                    else if (modalCategoryOptions && modalCategoryOptions.dataset && modalCategoryOptions.dataset.selected) selCat = parseInt(modalCategoryOptions.dataset.selected);
                    if (typeof selCat === 'number' && !Number.isNaN(selCat)) {
                        showAddSubcategoriesFor(selCat, modalSubcategories);
                    }
                    const badge = document.querySelector('.add-category-badge');
                    if (badge && badge.getAttribute('data-sub') === ctx.subName) {
                        badge.setAttribute('data-sub', newName);
                    }
                }
            } catch (_) {}
            // close rename modal
            if (renameModal) { renameModal.setAttribute('aria-hidden','true'); renameModal.style.display='none'; }
        });
    }
    if (renameCancel) renameCancel.addEventListener('click', () => { if (renameModal) { renameModal.setAttribute('aria-hidden','true'); renameModal.style.display='none'; } });
    if (renameClose) renameClose.addEventListener('click', () => { if (renameModal) { renameModal.setAttribute('aria-hidden','true'); renameModal.style.display='none'; } });

    // wire subcat action buttons
    m.querySelectorAll('.subcat-action-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action; const ctx = currentSubcatContext; if (!ctx) return; close();
            if (action === 'rename') {
                const r = document.getElementById('renameSubcatModal'); if (!r) return; const input = document.getElementById('renameSubcatInput'); input.value = ctx.subName || ''; r.setAttribute('aria-hidden','false'); r.style.display='flex';
            } else if (action === 'delete') {
                openConfirmModal({ title: 'Удали��ь подкатегорию', message: `Удалить подкатегорию "${ctx.subName}"? Задачи останутся без подкатегории.`, confirmText: 'Удалить', cancelText: 'Отмена', requireCheck: false, onConfirm: () => {
                    const raw = localStorage.getItem('customSubcategories'); const cs = raw?JSON.parse(raw):{}; const arr = Array.isArray(cs[ctx.category])?cs[ctx.category]:[]; cs[ctx.category] = arr.filter(n=>n!==ctx.subName); localStorage.setItem('customSubcategories', JSON.stringify(cs)); tasks = tasks.map(t=> (t.category===ctx.category && t.subcategory===ctx.subName) ? ({...t, subcategory: undefined}) : t);
saveTasks();
displayTasks();
try {
    if (addTaskModal && addTaskModal.style.display === 'flex') {
        let selCat = null;
        if (typeof modalPrimaryCategory === 'number' && modalPrimaryCategory !== null) {
            selCat = modalPrimaryCategory;
        } else if (modalCategoryOptions && modalCategoryOptions.dataset && modalCategoryOptions.dataset.selected) {
            selCat = parseInt(modalCategoryOptions.dataset.selected);
        }
        if (typeof selCat === 'number' && !Number.isNaN(selCat)) {
            showAddSubcategoriesFor(selCat, modalSubcategories);
        }
        const badge = document.querySelector('.add-category-badge');
        if (badge && badge.getAttribute('data-sub') === ctx.subName) {
            badge.setAttribute('data-sub', '');
        }
    }
} catch (_) {} } });
            } else if (action === 'move') {
                const mv = document.getElementById('moveTasksModal'); if (!mv) return; mv.setAttribute('aria-hidden','false'); mv.style.display='flex';
                // render category options
                const catCont = document.getElementById('moveCategoryOptions'); const subCont = document.getElementById('moveSubcategories'); renderCategoryButtons(catCont);
                // clear subCont until a category selected
                if (subCont) { subCont.innerHTML=''; subCont.style.display='none'; }
                // wire ok/cancel
                const okBtn = document.getElementById('moveTasksOk'); const cancel = document.getElementById('moveTasksCancel'); const closeBtn = document.getElementById('moveTasksClose'); const backdrop2 = document.getElementById('moveTasksBackdrop');
                const chk = document.getElementById('moveConfirmCheck'); if (chk) chk.checked = false; if (okBtn) okBtn.disabled = true;
                const enableOk = () => { if (okBtn) okBtn.disabled = !chk.checked; };
                chk.addEventListener('change', enableOk);
                const closeMove = () => { mv.setAttribute('aria-hidden','true'); mv.style.display='none'; chk.removeEventListener('change', enableOk); };
                if (cancel) cancel.onclick = closeMove; if (closeBtn) closeBtn.addEventListener('click', closeMove); if (backdrop2) backdrop2.addEventListener('click', closeMove);
                okBtn.onclick = () => {
                    const sel = catCont.querySelector('.modal-category-btn.selected'); if (!sel) return; const targetCat = parseInt(sel.dataset.category);
                    const selSub = subCont ? subCont.querySelector('.add-subcategory-btn.selected') : null; const targetSub = selSub ? selSub.dataset.sub || null : null;
                    // perform move
                    tasks = tasks.map(t => (t.category === ctx.category && t.subcategory === ctx.subName) ? ({...t, category: targetCat, subcategory: targetSub || undefined, statusChangedAt: Date.now()}) : t);
                    saveTasks(); displayTasks(); closeMove();
                };
            }
        });
    });
})();


function openAddModal(initialCategory, options = {}) {
    if (showArchive) { openInfoModal('Нельзя добавлять задачи в списке выполненных'); return; }
    if (!addTaskModal) return;
    addTaskModal.setAttribute('aria-hidden', 'false');
    addTaskModal.style.display = 'flex';
    modalTaskText.value = '';
    modalPrimaryCategory = null;

    if (options.restrict === 'section') {
        const sectionCats = options.sectionCats || '';
        const arr = String(sectionCats).split(',').map(s => s.trim()).filter(Boolean);
        // allowed categories are those in the section (do NOT include category 0 when opening from a section)
        const allowed = arr.length ? arr.map(Number) : [0];
        const primary = allowed.length ? Number(allowed[0]) : 0;
        modalPrimaryCategory = primary;
        renderModalCategoryOptions(allowed);

        // preselect first category button if present
        if (modalCategoryOptions) {
            const firstBtn = modalCategoryOptions.querySelector('.modal-category-btn');
            if (firstBtn) {
                firstBtn.click();
                modalCategoryOptions.dataset.selected = firstBtn.dataset.category;
            }
        }

        // determine if this primary category supports subcategories (defaults or saved)
        const customSubsRaw = localStorage.getItem('customSubcategories');
        const customSubs = customSubsRaw ? JSON.parse(customSubsRaw) : {};
        const hasDefaults = (primary === 1 || primary === 2 || primary === 4);
        const hasSaved = Array.isArray(customSubs[primary]) && customSubs[primary].length > 0;
        if (hasDefaults || hasSaved) {
            showAddSubcategoriesFor(primary, modalSubcategories);
        } else {
            if (modalSubcategories) { modalSubcategories.classList.remove('show'); modalSubcategories.style.display = 'none'; }
        }
        applyModalBackground(primary);
    } else {
        renderModalCategoryOptions();
        if (modalCategoryOptions && typeof initialCategory !== 'undefined' && initialCategory !== null) {
            const btn = modalCategoryOptions.querySelector(`.modal-category-btn[data-category="${initialCategory}"]`);
            if (btn) btn.click();
            else applyModalBackground(initialCategory);
        } else {
            // default neutral background
            applyModalBackground(initialCategory || 0);
        }
        showAddSubcategoriesFor(parseInt(initialCategory) || 0, modalSubcategories);
    }

    setTimeout(() => modalTaskText.focus(), 50);
}

function closeAddModal() {
    if (!addTaskModal) return;
    addTaskModal.setAttribute('aria-hidden', 'true');
    addTaskModal.style.display = 'none';
    if (modalSubcategories) { modalSubcategories.classList.remove('show'); modalSubcategories.style.display = 'none'; }
}

modalBackdrop && modalBackdrop.addEventListener('click', () => closeAddModal());
modalCloseBtn && modalCloseBtn.addEventListener('click', () => closeAddModal());
modalCancelBtn && modalCancelBtn.addEventListener('click', (e) => { e.preventDefault(); closeAddModal(); });

modalAddTaskBtn && modalAddTaskBtn.addEventListener('click', () => {
    const raw = modalTaskText.value;
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    let category = 0;
    if (modalCategoryOptions && modalCategoryOptions.dataset && modalCategoryOptions.dataset.selected) category = parseInt(modalCategoryOptions.dataset.selected);
    if (lines.length === 0) return;
    const selBtn = modalSubcategories ? modalSubcategories.querySelector('.add-subcategory-btn.selected') : null;
    let selectedSub = null;
    if (selBtn && typeof selBtn.dataset.sub !== 'undefined') selectedSub = selBtn.dataset.sub || null;
    if (selectedSub && typeof modalPrimaryCategory === 'number' && modalPrimaryCategory !== null) {
        category = modalPrimaryCategory;
    }
    if (lines.length > 1) {
        openConfirmModal({
            title: 'Подтверждение',
            message: `Добавить ${lines.length} задач?`,
            confirmText: 'Добавить',
            cancelText: 'Отмена',
            requireCheck: true,
            checkboxLabel: 'Подтв���рждаю добавление',
            onConfirm: () => { addLinesAsTasks(lines, category, selectedSub); }
        });
        return;
    }
    addLinesAsTasks(lines, category, selectedSub);
});

if (typeof addMultipleBtn !== 'undefined' && addMultipleBtn) {
    addMultipleBtn.style.display = 'none';
}

exportTasksBtn.addEventListener('click', exportTasks);

importFile.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        importTasks(e.target.files[0]);
        e.target.value = ''; // Сбра��ываем значение input
    }
});

// Paste tasks modal handling
const pasteTasksBtn = document.getElementById('pasteTasksBtn');
const pasteTasksModal = document.getElementById('pasteTasksModal');
const pasteTasksBackdrop = document.getElementById('pasteTasksBackdrop');
const pasteTasksCloseBtn = document.getElementById('pasteTasksCloseBtn');
const pasteTasksInput = document.getElementById('pasteTasksInput');
const pasteTasksAddBtn = document.getElementById('pasteTasksAddBtn');
const pasteTasksCancelBtn = document.getElementById('pasteTasksCancelBtn');

function openPasteModal() {
    if (showArchive) { openInfoModal('Нельзя добавлять задачи в списке выполненных'); return; }
    if (!pasteTasksModal) return;
    pasteTasksModal.setAttribute('aria-hidden','false');
    pasteTasksModal.style.display = 'flex';
    if (pasteTasksInput) { pasteTasksInput.value = ''; setTimeout(()=>pasteTasksInput.focus(), 50); }
}
function closePasteModal() {
    if (!pasteTasksModal) return;
    pasteTasksModal.setAttribute('aria-hidden','true');
    pasteTasksModal.style.display = 'none';
}

if (pasteTasksBtn) {
    pasteTasksBtn.addEventListener('click', openPasteModal);
}
[pasteTasksBackdrop, pasteTasksCloseBtn, pasteTasksCancelBtn].forEach(el => { if (el) el.addEventListener('click', closePasteModal); });

if (pasteTasksAddBtn) pasteTasksAddBtn.addEventListener('click', () => {
    if (showArchive) { openInfoModal('Нельзя добавлять задачи в списке выполненных'); return; }
    const raw = pasteTasksInput ? (pasteTasksInput.value || '') : '';
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    const addAll = () => {
        lines.forEach(text => {
            const newTask = { id: getNextId(), text, category: 0, completed: false, active: true, statusChangedAt: Date.now() };
            tasks.push(newTask);
        });
        saveTasks();
        closePasteModal();
        displayTasks();
    };
    if (lines.length > 1) {
        openConfirmModal({
            title: 'Подтверждение',
            message: `Добавить ${lines.length} задач?`,
            confirmText: 'Добавить',
            cancelText: 'Отмена',
            requireCheck: true,
            checkboxLabel: 'Подтверждаю добавление',
            onConfirm: addAll
        });
    } else {
        addAll();
    }
});

startTimerBtn.addEventListener('click', startTimer);
pauseTimerBtn.addEventListener('click', pauseTimer);
resetTimerBtn.addEventListener('click', resetTimer);

function completeCurrentTaskAndClose() {
    if (!currentTask) return Promise.resolve();
    const taskIndex = tasks.findIndex(t => t.id === currentTask.id);
    if (taskIndex !== -1) {
        tasks[taskIndex].completed = true;
        tasks[taskIndex].active = false;
        saveTasks();
    }
    return cancelServerSchedule().then(() => {
        stopTimer();
        timerEndAt = 0;
        hideTimer();
        displayTasks();
    });
}

completeTaskBtn.addEventListener('click', async () => {
    await completeCurrentTaskAndClose();
});

if (completeNowBtn) {
    completeNowBtn.addEventListener('click', async () => {
        await completeCurrentTaskAndClose();
    });
}

returnTaskBtn.addEventListener('click', async () => {
    await cancelServerSchedule();
    stopTimer();
    timerEndAt = 0;
    hideTimer();
});

closeTimerBtn.addEventListener('click', async () => {
    await cancelServerSchedule();
    stopTimer();
    timerEndAt = 0;
    hideTimer();
});

timerMinutes.addEventListener('change', () => {
    if (!timerRunning) {
        timerTime = Math.max(1, parseInt(timerMinutes.value)) * 60;
        updateTimerDisplay();
    }
});


// Service Worker для push-уведомлений
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        navigator.serviceWorker.register('/sw.js').then(function(registration) {
            console.log('ServiceWorker registration successful with scope: ', registration.scope);
        }, function(err) {
            console.log('ServiceWorker registration failed: ', err);
        });
    });
}

// Пересчет при возрае на кладку/разворачивании окна
window.addEventListener('focus', () => {
    if (timerRunning) {
        timerTime = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
        updateTimerDisplay();
        if (timerTime <= 0) {
            stopTimer();
            showNotification(currentTask ? `Задача: ${currentTask.text}` : undefined);
            timerCompleteOptions.style.display = 'flex';
            const controls = document.querySelector('.timer-controls');
            if (controls) controls.style.display = 'none';
        }
    }
});

// Функция для показа toast-уведомле��ия
function showToastNotification(title, message, duration = 5000) {
    let toast = document.getElementById('toast-notification');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-notification';
        toast.className = 'toast-notification';
        toast.innerHTML = `
            <div class="toast-icon">🎁</div>
            <div class="toast-content">
                <div class="toast-title"></div>
                <div class="toast-message"></div>
            </div>
            <button class="toast-close">&times;</button>
        `;
        document.body.appendChild(toast);
        toast.querySelector('.toast-close').addEventListener('click', () => {
            hideToastNotification();
        });
    }
    toast.querySelector('.toast-title').textContent = title;
    toast.querySelector('.toast-message').textContent = message;
    toast.classList.remove('hide');
    toast.classList.add('show');
    if (duration > 0) {
        setTimeout(() => {
            hideToastNotification();
        }, duration);
    }
    if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
    }
}

function hideToastNotification() {
    const toast = document.getElementById('toast-notification');
    if (toast) {
        toast.classList.remove('show');
        toast.classList.add('hide');
        setTimeout(() => {
            if (toast && toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }
}

if (notifyToggleBtn) {
    notifyToggleBtn.addEventListener('click', async () => {
        if (!('Notification' in window)) {
            openInfoModal('Уве��омления не по��держиваются этим браузером');
            return;
        }
        if (Notification.permission === 'granted') {
            await ensurePushSubscribed();
            createBrowserNotification('Уведомления включены');
            updateNotifyToggle();
            return;
        }
        try {
            const result = await Notification.requestPermission();
            if (result === 'granted') {
                await ensurePushSubscribed();
                createBrowserNotification('Уведомления включены');
            } else if (result === 'default') {
                openInfoModal('Ув��домления не включены. Подтвердите запрос браузера или разрешите их в настройках сайта.');
            } else if (result === 'denied') {
                openInfoModal('Уведомления заблок��рованы в настройках браузера. Разрешите их вручную.');
            }
        } catch (e) {
            openInfoModal('Не удалось запросить разрешение на уведомления. Откройте сайт напрямую и попробуйте снова.');
        }
        updateNotifyToggle();
    });
}
