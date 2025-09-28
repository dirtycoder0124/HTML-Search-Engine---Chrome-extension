// background.js
// Scans only active sites. Fetches internal .js files from the page context (avoids CORS).

chrome.webNavigation.onCompleted.addListener(async (details) => {
  try {
    if (details.frameId !== 0) return;
    if (!details.url.startsWith("http")) return;

    const domain = new URL(details.url).hostname;

    // read activeSites
    const { activeSites = {} } = await new Promise((res) =>
      chrome.storage.local.get("activeSites", res)
    );
    if (!activeSites[domain]) return;

    // read config
    chrome.storage.local.get(
      ["keywords", "notifyMode", "foundResults", "maxLinks", "scanInlineScripts"], // TOGGLE CHECK
      async (data) => {
        try {
          const keywords = data.keywords || [];
          const notifyMode = data.notifyMode || "notification";
          const maxLinks = data.maxLinks || "10";
          const scanInline = data.scanInlineScripts ?? true; // TOGGLE CHECK
          let foundResults = data.foundResults || [];

          if (notifyMode === "disabled") return;
          if (!keywords || keywords.length === 0) return;

          let found = [];

          // --- (1) Scan raw HTML ---
          try {
            let res = await fetch(details.url);
            let text = await res.text();
            for (let kw of keywords) {
              findMatches(text, details.url, kw, found);
            }
          } catch (e) {
            console.error("HTML_search fetch failed (page html):", details.url, e);
          }

          // --- (2) Run code in page context ---
          const [{ result: dom }] = await chrome.scripting.executeScript({
            target: { tabId: details.tabId },
            func: async () => {
              await new Promise((r) => setTimeout(r, 1000));
              const base = window.location.origin;
              const domain = window.location.hostname;

              const anchors = [...document.querySelectorAll("a[href]")];
              const links = anchors.map((a) => a.href).filter((h) => typeof h === "string" && h.startsWith(base));

              const scripts = [...document.querySelectorAll("script[src]")]
                .map((s) => s.src)
                .filter((s) => {
                  try { return new URL(s).hostname === domain; } 
                  catch (e) { return false; }
                });

              const inlineScripts = [...document.querySelectorAll("script:not([src])")]
                .map((s) => s.innerText)
                .filter(Boolean);

              const scriptContents = await Promise.all(
                scripts.map(async (src) => {
                  try {
                    const r = await fetch(src, { cache: "no-cache" });
                    const txt = await r.text();
                    return { src, text: txt };
                  } catch (err) {
                    return { src, text: null, error: String(err) };
                  }
                })
              );

              return { html: document.documentElement.outerHTML, links: [...new Set(links)], scripts: [...new Set(scripts)], inlineScripts, scriptContents };
            },
          });

          // --- (2b) Scan DOM HTML ---
          for (let kw of keywords) {
            findMatches(dom.html || "", details.url, kw, found);
          }

          // --- (3) Scan internal script contents ---
          if (Array.isArray(dom.scriptContents)) {
            for (const s of dom.scriptContents) {
              if (s && s.text) {
                for (let kw of keywords) {
                  findMatches(s.text, s.src, kw, found);
                }
              } else {
                console.error("HTML_search: failed to fetch script:", s && s.src, s && s.error);
              }
            }
          }

          // --- (3b) Scan inline JS code (TOGGLE CHECK) ---
          if (scanInline && Array.isArray(dom.inlineScripts)) {
            for (const scriptContent of dom.inlineScripts) {
              for (let kw of keywords) {
                findMatches(scriptContent, details.url + " [inline script]", kw, found);
              }
            }
          }

          // --- (4) Scan internal links ---
          const linkLimit = maxLinks === "all" ? dom.links.length : parseInt(maxLinks, 10) || 0;
          for (let i = 0; i < Math.min(dom.links.length, linkLimit); i++) {
            try {
              let res = await fetch(dom.links[i]);
              let text = await res.text();
              for (let kw of keywords) {
                findMatches(text, dom.links[i], kw, found);
              }
            } catch (e) {
              console.error("HTML_search link fetch failed:", dom.links[i], e);
            }
          }

          // --- (5) Save unique results + notify ---
          if (found.length > 0) {
            found.forEach((f) => {
              const exists = foundResults.some(
                (r) => r.url === f.url && r.keyword === f.keyword && r.lineNum === f.lineNum
              );
              if (!exists) foundResults.push(f);
            });

            chrome.storage.local.set({ foundResults });

            if (notifyMode !== "disabled") {
              let message = found.slice(0, 3).map((f) => `${f.keyword} @ ${f.url}`).join("\n");
              if (found.length > 3) message += `\n+${found.length - 3} more...`;

              if (notifyMode === "notification") {
                chrome.notifications.create({
                  type: "basic",
                  iconUrl: "icon.png",
                  title: "HTML_search found matches!",
                  message: message || `${found.length} matches found.`,
                  priority: 2,
                  requireInteraction: true,
                });
              } else if (notifyMode === "alert") {
                chrome.scripting.executeScript({
                  target: { tabId: details.tabId },
                  func: (msg) => alert("HTML_search:\n" + msg),
                  args: [message],
                });
              }
            }
          }
        } catch (err) {
          console.error("HTML_search autorun inner error:", err);
        }
      }
    );
  } catch (err) {
    console.error("HTML_search onCompleted outer error:", err);
  }
});

// simple line-by-line match helper
function findMatches(source, url, keyword, results) {
  if (!source || !keyword) return;
  const lines = source.split("\n");
  const lowKw = keyword.toLowerCase();
  lines.forEach((line, i) => {
    if (line.toLowerCase().includes(lowKw)) {
      results.push({ url, keyword, line: line.trim(), lineNum: i + 1 });
    }
  });
}
