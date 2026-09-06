(async function () {
    "use strict";

    const NS = "ch_export_";
    const BASE_URL = `${location.origin}/game.php`;
    const REQUEST_DELAY = 250;
    const DEFAULT_MAX_PAGES = 2000;
    const FARM_TYPES = ["loot_res", "loot", "loot_all"];

    const state = {
        members: new Map(),
        tribeShares: new Map(),
        buddyShares: new Map(),
        scavenge: new Map(),
        farm: new Map(),
        targetAllies: new Map(),
        rows: [],
        csvOutput: "",
        htmlOutput: "",
        settings: {
            tribe: "",
            checkFriendCommands: true,
            falseCommandNote: ""
        }
    };

    // combined tribe/friend command-sharing states requested by council
    const STATUS_LABELS = {
        same_tribe_shared: "Plemię: udostępnia",
        same_tribe_hidden: "Plemię: brak",
        not_friend: "Poza plemieniem: nie znajomy",
        friend_hidden: "Poza plemieniem: znajomy, brak",
        friend_shared: "Poza plemieniem: znajomy, udostępnia"
    };

    const byId = id => document.getElementById(NS + id);
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const clean = value => String(value || "").replace(/\u00a0/g, " ").trim();
    const normalize = value => clean(value).replace(/\s+/g, "").toLowerCase();
    const parseNumber = value => {
        const number = parseInt(clean(value).replace(/\./g, "").replace(/,/g, "").replace(/\s+/g, ""), 10);
        return Number.isFinite(number) ? number : 0;
    };
    const escapeCsv = value => {
        const text = String(value ?? "");
        if (/[;"\n\r]/.test(text)) {
            return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
    };
    const escapeHtml = value => String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const formatNumber = value => Number(value || 0).toLocaleString("de-DE");

    function buildUrl(params) {
        const url = new URL(BASE_URL);
        if (window.game_data?.village?.id) {
            url.searchParams.set("village", window.game_data.village.id);
        }
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null && value !== "") {
                url.searchParams.set(key, value);
            }
        }
        return url.toString();
    }

    async function fetchDoc(url) {
        const response = await fetch(url, { credentials: "include" });
        if (response.status === 429) {
            await wait(1500);
            return fetchDoc(url);
        }
        const html = await response.text();
        return new DOMParser().parseFromString(html, "text/html");
    }

    async function fetchText(url) {
        const response = await fetch(url, { credentials: "include", cache: "no-store" });
        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.status}`);
        }
        return response.text();
    }

    function decodeMapValue(value) {
        const text = String(value || "").replace(/\+/g, " ");
        try {
            return decodeURIComponent(text);
        } catch (_) {
            return text;
        }
    }

    function parseMapLine(line) {
        return line.split(",").map(decodeMapValue);
    }

    function getQuery(name) {
        return new URLSearchParams(location.search).get(name);
    }

    function inferCurrentTribe() {
        const title = clean(document.querySelector("#content_value h2, #ally_content h2, h2")?.textContent);
        const tagMatch = title.match(/\(([^()]+)\)\s*$/);
        if (tagMatch) return tagMatch[1];
        const allyLinks = [...document.querySelectorAll('a[href*="screen=info_ally"]')]
            .map(link => clean(link.textContent))
            .filter(Boolean);
        return allyLinks[0] || "";
    }

    function parseTargetTribes(input) {
        return input.split(/\n|,/)
            .map(value => clean(value))
            .filter(Boolean)
            .map((label, index) => ({ label, normalized: normalize(label), index, allyId: null }));
    }

    function matchTargetTribe(tribe, targetTribes) {
        const normalized = normalize(tribe);
        return targetTribes.find(target => normalized.includes(target.normalized));
    }

    function isSameTribe(target) {
        const viewerAlly = window.game_data?.player?.ally;
        return Boolean(target?.allyId && viewerAlly && String(target.allyId) === String(viewerAlly));
    }

    function readPlayerFromRow(row) {
        const playerLink = row.querySelector('a[href*="screen=info_player"]');
        if (!playerLink) return null;

        const player = clean(playerLink.textContent);
        if (!player) return null;

        const href = new URL(playerLink.getAttribute("href"), location.origin);
        const id = href.searchParams.get("id") || href.searchParams.get("player_id") || "";
        const cells = [...row.cells].map(cell => clean(cell.textContent));
        const points = cells.reduce((best, text) => {
            const value = parseNumber(text);
            return value > best ? value : best;
        }, 0);

        return { id, player, points, tribe: "", target: null };
    }

    function parseMembers(doc, tribeInfo = null) {
        const members = new Map();
        for (const row of doc.querySelectorAll("table.vis tr, table tr")) {
            const member = readPlayerFromRow(row);
            if (!member) continue;
            if (tribeInfo) {
                member.tribe = tribeInfo.tribe;
                member.target = tribeInfo.target;
            }
            if (!members.has(member.player) || member.points > members.get(member.player).points) {
                members.set(member.player, member);
            }
        }
        return members;
    }

    async function getMembers() {
        const docs = [document];
        const allyId = getQuery("id");
        if (allyId) {
            docs.push(await fetchDoc(buildUrl({ screen: "info_ally", id: allyId })));
        }
        if (window.game_data?.player?.ally) {
            docs.push(await fetchDoc(buildUrl({ screen: "ally", mode: "members" })));
        }

        let best = new Map();
        for (const doc of docs) {
            const parsed = parseMembers(doc);
            if (parsed.size > best.size) best = parsed;
        }
        return best;
    }

    async function loadWorldMapMembers(targetTribes) {
        const [allyText, playerText] = await Promise.all([
            fetchText(`${location.origin}/map/ally.txt`),
            fetchText(`${location.origin}/map/player.txt`)
        ]);

        const targetByAllyId = new Map();
        for (const line of allyText.split("\n")) {
            if (!line.trim()) continue;
            const [id, name, tag] = parseMapLine(line);
            const target = targetTribes.find(item => normalize(tag) === item.normalized || normalize(name) === item.normalized || normalize(tag).includes(item.normalized) || normalize(name).includes(item.normalized));
            if (!id || !target) continue;
            target.allyId ||= id;
            targetByAllyId.set(id, { id, tribe: tag || name, target });
            state.targetAllies.set(id, { id, tribe: tag || name, target });
        }

        if (!targetByAllyId.size) {
            throw new Error("No matching tribes found in /map/ally.txt");
        }

        const members = new Map();
        for (const line of playerText.split("\n")) {
            if (!line.trim()) continue;
            const [id, name, allyId, villages, points] = parseMapLine(line);
            const ally = targetByAllyId.get(allyId);
            if (!ally || !name) continue;
            members.set(name, {
                id,
                player: name,
                points: parseNumber(points),
                villages: parseNumber(villages),
                tribe: ally.tribe,
                target: ally.target
            });
        }

        return members;
    }

    // real signal: settings > command_sharing lists everyone sharing commands with the viewer
    function rowSharesCommands(row) {
        return Boolean(row.querySelector('img[src*="confirm"]'));
    }

    function parseCommandSharingForm(form) {
        const rows = new Map();
        if (!form) return rows;
        for (const row of form.querySelectorAll("table.vis tr")) {
            const link = row.querySelector('a[href*="screen=info_player"]');
            const player = clean(link?.textContent);
            if (!player) continue;
            rows.set(player, rowSharesCommands(row));
        }
        return rows;
    }

    async function loadCommandSharing() {
        // GET requests with action=command_sharing&type=... get rejected as "Nieważna komenda";
        // both tables are already present on the plain mode=command_sharing page
        try {
            const doc = await fetchDoc(buildUrl({ screen: "settings", mode: "command_sharing" }));
            const forms = [...doc.querySelectorAll("form")];
            state.tribeShares = parseCommandSharingForm(forms.find(form => form.getAttribute("action")?.includes("type=ally")));
            state.buddyShares = state.settings.checkFriendCommands
                ? parseCommandSharingForm(forms.find(form => form.getAttribute("action")?.includes("type=buddy")))
                : new Map();
        } catch (error) {
            console.warn("command_sharing page failed", error);
        }
    }

    async function loadTargetTribeMembers() {
        const allies = [...state.targetAllies.values()];
        for (let index = 0; index < allies.length; index++) {
            const ally = allies[index];
            setProgress(`Reading tribe members ${index + 1}/${allies.length}`);
            const doc = await fetchDoc(buildUrl({ screen: "info_ally", id: ally.id }));
            const members = parseMembers(doc, ally);
            for (const [player, member] of members) {
                const current = state.members.get(player);
                if (!current || member.points >= current.points || !current.target) {
                    state.members.set(player, member);
                }
            }
            await wait(REQUEST_DELAY);
        }
    }

    // 5 states requested: same-tribe shared/hidden, outsider not-friend/friend-hidden/friend-shared
    function classifyCommandStatus(row) {
        if (isSameTribe(row.target)) {
            const shared = state.tribeShares.get(row.player) === true;
            return { status: shared ? "same_tribe_shared" : "same_tribe_hidden", access: shared, source: "tribe" };
        }
        if (!state.buddyShares.has(row.player)) {
            return { status: "not_friend", access: false, source: "" };
        }
        const shared = state.buddyShares.get(row.player) === true;
        return { status: shared ? "friend_shared" : "friend_hidden", access: shared, source: shared ? "friend" : "" };
    }

    function parseRankingRows(doc, targetTribes) {
        const rows = [];
        let scannedRows = 0;
        const tables = [doc.querySelector("#in_a_day_ranking_table"), ...doc.querySelectorAll("table.vis")].filter(Boolean);

        for (const table of tables) {
            for (const row of table.querySelectorAll("tr")) {
                const cells = row.querySelectorAll("td");
                if (cells.length < 4) continue;
                scannedRows++;

                const playerLink = cells[1]?.querySelector('a[href*="screen=info_player"]');
                const player = clean(playerLink?.textContent || cells[1]?.textContent);
                const playerHref = playerLink ? new URL(playerLink.getAttribute("href"), location.origin) : null;
                const id = playerHref?.searchParams.get("id") || playerHref?.searchParams.get("player_id") || "";
                const allyLink = cells[2]?.querySelector('a[href*="screen=info_ally"]');
                const ally = clean(allyLink?.textContent || cells[2]?.textContent);
                const allyHref = allyLink ? new URL(allyLink.getAttribute("href"), location.origin) : null;
                const allyId = allyHref?.searchParams.get("id") || "";
                const points = parseNumber(cells[3]?.textContent);
                if (!player || !points) continue;

                const target = matchTargetTribe(ally, targetTribes);
                if (!target) continue;
                if (allyId) {
                    target.allyId ||= allyId;
                    if (!state.targetAllies.has(allyId)) {
                        state.targetAllies.set(allyId, { id: allyId, tribe: ally, target });
                    }
                }

                rows.push({ player, id, ally, target, points });
            }
        }

        return { rows, scannedRows };
    }

    async function scanRanking(type, targetTribes, maxPages) {
        const result = new Map();
        for (let page = 0; page < maxPages; page++) {
            setProgress(`Scanning ${type}, page ${page + 1}/${maxPages}`);
            const doc = await fetchDoc(buildUrl({ screen: "ranking", mode: "in_a_day", type, offset: page * 25 }));
            const { rows, scannedRows } = parseRankingRows(doc, targetTribes);
            if (!scannedRows) break;
            for (const row of rows) {
                if (!result.has(row.player) || row.points > result.get(row.player).points) {
                    result.set(row.player, row);
                }
            }
            await wait(REQUEST_DELAY);
        }
        return result;
    }

    async function scanFarm(targetTribes, maxPages) {
        let best = new Map();
        let bestType = FARM_TYPES[0];
        for (const type of FARM_TYPES) {
            const data = await scanRanking(type, targetTribes, Math.min(maxPages, 8));
            if (data.size > best.size) {
                best = data;
                bestType = type;
            }
            if (data.size > 0) break;
        }

        if (maxPages > 8) {
            best = await scanRanking(bestType, targetTribes, maxPages);
        }
        return best;
    }

    function getTribeColor(target) {
        const colors = ["#d9ead3", "#cfe2f3", "#fce5cd", "#eadcf8", "#fff2cc", "#d0e0e3", "#f4cccc", "#d9d2e9"];
        return colors[(target?.index || 0) % colors.length];
    }

    function buildRows(targetTribes) {
        const players = new Map();

        for (const [player, member] of state.members) {
            const target = member.target || (targetTribes.length === 1 ? targetTribes[0] : null);
            if (target) {
                players.set(player, { player, id: member.id, tribe: member.tribe || target.label, target, points: member.points || 0 });
            }
        }
        for (const ranking of [...state.scavenge.values(), ...state.farm.values()]) {
            if (!players.has(ranking.player)) {
                players.set(ranking.player, {
                    player: ranking.player,
                    id: ranking.id,
                    tribe: ranking.ally,
                    target: ranking.target,
                    points: state.members.get(ranking.player)?.points || 0
                });
            } else {
                const current = players.get(ranking.player);
                current.id ||= ranking.id;
                current.tribe = ranking.ally || current.tribe;
                current.target = ranking.target || current.target;
            }
        }

        return [...players.values()].filter(row => row.target).map(row => {
            const scavenge = state.scavenge.get(row.player)?.points || 0;
            const farm = state.farm.get(row.player)?.points || 0;
            const { status, access, source } = classifyCommandStatus(row);
            const note = !access && state.settings.falseCommandNote ? state.settings.falseCommandNote : "";
            return {
                player: row.player,
                id: row.id || "",
                tribe: row.tribe || row.target.label,
                target: row.target,
                points: row.points,
                scavenge,
                farm,
                total: scavenge + farm,
                commandAccess: access,
                commandStatus: status,
                commandSource: source,
                note
            };
        }).sort((a, b) => a.target.index - b.target.index || b.points - a.points || b.total - a.total || a.player.localeCompare(b.player));
    }

    function buildCsv(rows) {
        const lines = ["plemie;gracz;pkt;zbierak;farma;suma;komendy;status_komend;"];
        for (const row of rows) {
            lines.push([
                escapeCsv(row.tribe),
                escapeCsv(row.player),
                row.points,
                row.scavenge,
                row.farm,
                row.total,
                row.commandAccess ? "WAHR" : "FALSCH",
                escapeCsv(STATUS_LABELS[row.commandStatus] || row.commandStatus),
                escapeCsv(row.note)
            ].join(";"));
        }
        return lines.join("\n");
    }

    function buildHtml(rows, targetTribes) {
        const header = ["Plemię", "Gracz", "Pkt", "Zbierak", "Farma", "Suma", "Komendy", "Status komend", "Notatka"];
        const cell = (row, value, numeric = false) => {
            const color = getTribeColor(row.target);
            const align = numeric ? "right" : "left";
            return `<td bgcolor="${color}" style="background-color:${color};text-align:${align}">${escapeHtml(value)}</td>`;
        };
        const rowHtml = row => {
            return `<tr>${[
                cell(row, row.tribe),
                cell(row, row.player),
                cell(row, formatNumber(row.points), true),
                cell(row, formatNumber(row.scavenge), true),
                cell(row, formatNumber(row.farm), true),
                cell(row, formatNumber(row.total), true),
                cell(row, row.commandAccess ? "WAHR" : "FALSCH"),
                cell(row, STATUS_LABELS[row.commandStatus] || row.commandStatus),
                cell(row, row.note)
            ].join("")}</tr>`;
        };
        const table = (title, tableRows) => `
            <h2>${escapeHtml(title)}</h2>
            <table>
                <thead><tr>${header.map(column => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
                <tbody>${tableRows.map(rowHtml).join("")}</tbody>
            </table>`;
        const tribeTables = targetTribes
            .map(target => {
                const tribeRows = rows.filter(row => row.target.index === target.index);
                return table(`${target.label} members (${tribeRows.length})`, tribeRows);
            })
            .join("");

        return `<!doctype html>
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head>
<meta charset="utf-8">
<style>
body{font-family:Arial,sans-serif;color:#111}
h2{font-size:16pt;margin:14px 0 6px}
table{border-collapse:collapse;margin-bottom:18px}
th,td{border:1px solid #666;padding:4px 7px;mso-number-format:"\\@"}
th{background:#305496;color:#fff;font-weight:bold}
    td:nth-child(3),td:nth-child(4),td:nth-child(5),td:nth-child(6){mso-number-format:"0"}
</style>
</head>
<body>
${tribeTables}
</body>
</html>`;
    }

    function setProgress(text) {
        const el = byId("progress");
        if (el) el.textContent = text;
    }

    function removeUi() {
        document.getElementById(NS + "overlay")?.remove();
        document.getElementById(NS + "result")?.remove();
        document.getElementById(NS + "style")?.remove();
    }

    function downloadText(filename, content, type) {
        const blob = new Blob([content], { type });
        const anchor = document.createElement("a");
        anchor.href = URL.createObjectURL(blob);
        anchor.download = filename;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
    }

    function showResult() {
        document.getElementById(NS + "result")?.remove();
        const overlay = document.createElement("div");
        overlay.id = NS + "result";
        overlay.className = "ch-overlay";
        overlay.innerHTML = `
            <div class="ch-result-card">
                <div class="ch-header">
                    <h2>Council export</h2>
                    <button id="${NS}close_result" type="button">x</button>
                </div>
                <div class="ch-body">
                    <textarea id="${NS}output" readonly></textarea>
                    <div class="ch-actions">
                        <button id="${NS}copy" type="button">Copy CSV</button>
                        <button id="${NS}download" type="button">Download CSV</button>
                        <button id="${NS}download_html" type="button">Download colored XLS</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        byId("output").value = state.csvOutput;
        byId("close_result").onclick = () => overlay.remove();
        byId("copy").onclick = async () => {
            await navigator.clipboard.writeText(state.csvOutput);
            if (window.UI?.SuccessMessage) UI.SuccessMessage("Copied");
        };
        byId("download").onclick = () => downloadText("tribe_council_export.csv", state.csvOutput, "text/csv;charset=utf-8");
        byId("download_html").onclick = () => downloadText("tribe_council_export_colored.xls", state.htmlOutput, "application/vnd.ms-excel;charset=utf-8");
    }

    async function start() {
        const startButton = byId("start");
        startButton.disabled = true;
        try {
            state.settings.tribe = byId("tribe").value;
            state.settings.checkFriendCommands = byId("friend_commands").checked;
            state.settings.falseCommandNote = byId("note").value.trim();

            const targetTribes = parseTargetTribes(state.settings.tribe);
            if (!targetTribes.length) {
                throw new Error("Enter at least one tribe tag/name");
            }
            state.targetAllies = new Map();
            state.tribeShares = new Map();
            state.buddyShares = new Map();

            setProgress("Reading world map tribe members");
            try {
                state.members = await loadWorldMapMembers(targetTribes);
            } catch (error) {
                console.warn(error);
                setProgress("Map data failed, reading visible tribe members");
                state.members = await getMembers();
            }

            setProgress("Reading command sharing settings");
            await loadCommandSharing();

            state.scavenge = await scanRanking("scavenge", targetTribes, DEFAULT_MAX_PAGES);
            state.farm = await scanFarm(targetTribes, DEFAULT_MAX_PAGES);
            await loadTargetTribeMembers();

            state.rows = buildRows(targetTribes);
            state.csvOutput = buildCsv(state.rows);
            state.htmlOutput = buildHtml(state.rows, targetTribes);
            setProgress(`Done: ${state.rows.length} rows`);
            showResult();
        } catch (error) {
            console.error(error);
            setProgress(error.message || String(error));
            if (window.UI?.ErrorMessage) UI.ErrorMessage(error.message || String(error));
        } finally {
            startButton.disabled = false;
        }
    }

    function createUi() {
        removeUi();
        const style = document.createElement("style");
        style.id = NS + "style";
        style.textContent = `
            .ch-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(5,10,18,.72);display:flex;align-items:center;justify-content:center;padding:16px;font-family:Verdana,Arial,sans-serif;color:#172033}
            .ch-card,.ch-result-card{width:min(560px,96vw);background:#fff;border:2px solid #2f6f73;border-radius:8px;box-shadow:0 20px 45px rgba(0,0,0,.35);overflow:hidden}
            .ch-result-card{width:min(980px,96vw)}
            .ch-header{display:flex;align-items:center;justify-content:space-between;background:#2f6f73;color:#fff;padding:10px 12px}
            .ch-header h2{margin:0;font-size:20px;letter-spacing:0}
            .ch-header button{width:30px;height:30px;border:1px solid rgba(255,255,255,.65);border-radius:6px;background:rgba(255,255,255,.14);color:#fff;cursor:pointer}
            .ch-body{display:flex;flex-direction:column;gap:10px;padding:12px;background:#f7faf8}
            .ch-body label{font-weight:700;font-size:13px;color:#263238}
            .ch-body input,.ch-body textarea{width:100%;box-sizing:border-box;border:1px solid #a8c4bd;border-radius:6px;padding:8px;background:#fff;color:#111;font:13px Verdana,Arial,sans-serif}
            .ch-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
            .ch-check{display:flex;gap:8px;align-items:center;font-size:13px;font-weight:700}
            .ch-check input{width:auto}
            .ch-actions{display:flex;gap:8px;flex-wrap:wrap}
            .ch-actions button,#${NS}start{border:1px solid #265f62;border-radius:6px;background:#2f6f73;color:#fff;font-weight:700;padding:9px 12px;cursor:pointer}
            .ch-actions button:hover,#${NS}start:hover{filter:brightness(1.08)}
            #${NS}progress{min-height:18px;font-size:12px;color:#263238;white-space:pre-wrap}
            #${NS}output{min-height:420px;font-family:Consolas,Monaco,monospace;font-size:12px;resize:vertical}
        `;
        document.head.appendChild(style);

        const overlay = document.createElement("div");
        overlay.id = NS + "overlay";
        overlay.className = "ch-overlay";
        overlay.innerHTML = `
            <div class="ch-card">
                <div class="ch-header">
                    <h2>Council export</h2>
                    <button id="${NS}close" type="button">x</button>
                </div>
                <div class="ch-body">
                    <label for="${NS}tribe">Tribe tag/name filter</label>
                    <textarea id="${NS}tribe" rows="3" placeholder=":G:\n;G;"></textarea>
                    <div class="ch-row">
                        <label>False command note
                            <input id="${NS}note" type="text" placeholder="optional">
                        </label>
                    </div>
                    <label class="ch-check"><input id="${NS}friend_commands" type="checkbox" checked> Check outside-tribe friend/command status</label>
                    <button id="${NS}start" type="button">Start export</button>
                    <div id="${NS}progress">Ready</div>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        byId("tribe").value = inferCurrentTribe();
        byId("close").onclick = removeUi;
        byId("start").onclick = start;
    }

    createUi();
})();