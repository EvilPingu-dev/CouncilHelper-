(async function () {
    "use strict";

    const NS = "ch_export_";
    const BASE_URL = `${location.origin}/game.php`;
    const REQUEST_DELAY = 250;
    const DEFAULT_MAX_PAGES = 80;
    const FARM_TYPES = ["loot_res", "loot", "loot_all"];

    const state = {
        members: new Map(),
        commandAccess: new Map(),
        scavenge: new Map(),
        farm: new Map(),
        output: "",
        settings: {
            tribe: "",
            maxPages: DEFAULT_MAX_PAGES,
            allRankingTribes: false,
            falseCommandNote: ""
        }
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

        return { id, player, points };
    }

    function parseMembers(doc) {
        const members = new Map();
        for (const row of doc.querySelectorAll("table.vis tr, table tr")) {
            const member = readPlayerFromRow(row);
            if (!member) continue;
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

    async function getCommandAccess() {
        const access = new Map();
        if (!window.game_data?.player?.ally) return access;

        const doc = await fetchDoc(buildUrl({ screen: "ally", mode: "members_troops" }));
        for (const option of doc.querySelectorAll("select option")) {
            const player = clean(option.label || option.textContent)
                .replace(/\([^)]*dost[^)]*\)$/i, "")
                .trim();
            if (!player || option.value === "") continue;
            access.set(player, !option.disabled);
        }
        return access;
    }

    function parseRankingRows(doc, targetTribes, memberNames, allRankingTribes) {
        const rows = [];
        const tables = [doc.querySelector("#in_a_day_ranking_table"), ...doc.querySelectorAll("table.vis")].filter(Boolean);

        for (const table of tables) {
            for (const row of table.querySelectorAll("tr")) {
                const cells = row.querySelectorAll("td");
                if (cells.length < 4) continue;

                const player = clean(cells[1]?.querySelector('a[href*="screen=info_player"]')?.textContent || cells[1]?.textContent);
                const ally = clean(cells[2]?.querySelector('a[href*="screen=info_ally"]')?.textContent || cells[2]?.textContent);
                const points = parseNumber(cells[3]?.textContent);
                if (!player || !points) continue;

                const playerMatches = memberNames.size > 0 && memberNames.has(player);
                const tribeMatches = targetTribes.length > 0 && targetTribes.some(target => normalize(ally).includes(target));
                if (!allRankingTribes && !playerMatches && !tribeMatches) continue;

                rows.push({ player, ally, points });
            }
        }

        return rows;
    }

    async function scanRanking(type, targetTribes, memberNames, allRankingTribes, maxPages) {
        const result = new Map();
        for (let page = 0; page < maxPages; page++) {
            setProgress(`Scanning ${type}, page ${page + 1}/${maxPages}`);
            const doc = await fetchDoc(buildUrl({ screen: "ranking", mode: "in_a_day", type, offset: page * 25 }));
            const rows = parseRankingRows(doc, targetTribes, memberNames, allRankingTribes);
            if (!rows.length && page > 2) break;
            for (const row of rows) {
                if (!result.has(row.player) || row.points > result.get(row.player).points) {
                    result.set(row.player, row);
                }
            }
            await wait(REQUEST_DELAY);
        }
        return result;
    }

    async function scanFarm(targetTribes, memberNames, allRankingTribes, maxPages) {
        let best = new Map();
        let bestType = FARM_TYPES[0];
        for (const type of FARM_TYPES) {
            const data = await scanRanking(type, targetTribes, memberNames, allRankingTribes, Math.min(maxPages, 8));
            if (data.size > best.size) {
                best = data;
                bestType = type;
            }
            if (data.size > 0) break;
        }

        if (maxPages > 8) {
            best = await scanRanking(bestType, targetTribes, memberNames, allRankingTribes, maxPages);
        }
        return best;
    }

    function buildCsv() {
        const players = new Map();

        for (const [player, member] of state.members) {
            players.set(player, { player, points: member.points || 0 });
        }
        for (const player of [...state.scavenge.keys(), ...state.farm.keys()]) {
            if (!players.has(player)) players.set(player, { player, points: 0 });
        }

        const rows = [...players.values()].map(row => {
            const scavenge = state.scavenge.get(row.player)?.points || 0;
            const farm = state.farm.get(row.player)?.points || 0;
            const hasCommandData = state.commandAccess.has(row.player);
            const commandAccess = hasCommandData ? state.commandAccess.get(row.player) : false;
            const note = !commandAccess && state.settings.falseCommandNote ? state.settings.falseCommandNote : "";
            return {
                player: row.player,
                points: row.points,
                scavenge,
                farm,
                total: scavenge + farm,
                commandAccess,
                note
            };
        }).sort((a, b) => b.points - a.points || b.total - a.total || a.player.localeCompare(b.player));

        const lines = ["gracz;pkt;zbierak;farma;suma;komendy;"];
        for (const row of rows) {
            lines.push([
                escapeCsv(row.player),
                row.points,
                row.scavenge,
                row.farm,
                row.total,
                row.commandAccess ? "WAHR" : "FALSCH",
                escapeCsv(row.note)
            ].join(";"));
        }
        return lines.join("\n");
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
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        byId("output").value = state.output;
        byId("close_result").onclick = () => overlay.remove();
        byId("copy").onclick = async () => {
            await navigator.clipboard.writeText(state.output);
            if (window.UI?.SuccessMessage) UI.SuccessMessage("Copied");
        };
        byId("download").onclick = () => downloadText("tribe_council_export.csv", state.output, "text/csv;charset=utf-8");
    }

    async function start() {
        const startButton = byId("start");
        startButton.disabled = true;
        try {
            state.settings.tribe = byId("tribe").value;
            state.settings.maxPages = parseInt(byId("pages").value, 10) || DEFAULT_MAX_PAGES;
            state.settings.allRankingTribes = byId("all_tribes").checked;
            state.settings.falseCommandNote = byId("note").value.trim();

            const targetTribes = state.settings.tribe.split(/\n|,|;/).map(normalize).filter(Boolean);

            setProgress("Reading tribe members");
            state.members = await getMembers();
            const memberNames = new Set(state.members.keys());

            setProgress("Reading command access");
            state.commandAccess = await getCommandAccess();

            state.scavenge = await scanRanking("scavenge", targetTribes, memberNames, state.settings.allRankingTribes, state.settings.maxPages);
            state.farm = await scanFarm(targetTribes, memberNames, state.settings.allRankingTribes, state.settings.maxPages);

            state.output = buildCsv();
            setProgress(`Done: ${state.output.split("\n").length - 1} rows`);
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
                    <textarea id="${NS}tribe" rows="3" placeholder="One tribe per line"></textarea>
                    <div class="ch-row">
                        <label>Ranking pages
                            <input id="${NS}pages" type="number" min="1" max="200" value="${DEFAULT_MAX_PAGES}">
                        </label>
                        <label>False command note
                            <input id="${NS}note" type="text" placeholder="optional">
                        </label>
                    </div>
                    <label class="ch-check"><input id="${NS}all_tribes" type="checkbox"> Export all ranking tribes found</label>
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