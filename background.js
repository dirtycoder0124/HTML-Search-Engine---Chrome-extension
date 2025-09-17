chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (!details.url.startsWith("http")) return;

  chrome.storage.local.get(
    ["keywords", "notifyMode", "foundResults", "maxLinks"],
    async (data) => {
      const keywords = data.keywords || [];
      const notifyMode = data.notifyMode || "notification";
      const maxLinks = data.maxLinks || "10";
      let foundResults = data.foundResults || [];

      // 🚫 Disable completely if notifications disabled
      if (notifyMode === "disabled") return;
      if (keywords.length === 0) return;

      let found = [];

      try {
        // --- (1) Scan raw HTML source ---
        try {
          let res = await fetch(details.url);
          let text = await res.text();
          for (let kw of keywords) {
            findMatches(text, details.url, kw, found);
          }
        } catch (e) {
          console.error("HTML_search fetch failed:", details.url, e);
        }

        // --- (2) Scan live DOM after delay (for dynamic content) ---
        const [{ result: dom }] = await chrome.scripting.executeScript({
          target: { tabId: details.tabId },
          func: async () => {
            // wait for hydration
            await new Promise(r => setTimeout(r, 2000));
            const base = window.location.origin;
            const anchors = [...document.querySelectorAll("a[href]")];
            const links = anchors
              .map(a => a.href)
              .filter(h => h.startsWith(base));
            return {
              html: document.documentElement.outerHTML,
              links: [...new Set(links)]
            };
          }
        });

        for (let kw of keywords) {
          findMatches(dom.html, details.url, kw, found);
        }

        // --- (3) Scan internal links (limited by maxLinks) ---
        const linkLimit =
          maxLinks === "all" ? dom.links.length : parseInt(maxLinks);

        for (let i = 0; i < Math.min(dom.links.length, linkLimit); i++) {
          try {
            let res = await fetch(dom.links[i]);
            let text = await res.text();
            for (let kw of keywords) {
              findMatches(text, dom.links[i], kw, found);
            }
          } catch (e) {
            console.error("HTML_search fetch failed:", dom.links[i], e);
          }
        }

        // --- (4) Save + notify ---
        if (found.length > 0) {
          found.forEach(f => {
            if (
              !foundResults.some(
                r => r.url === f.url && r.keyword === f.keyword && r.lineNum === f.lineNum
              )
            ) {
              foundResults.push(f);
            }
          });

          chrome.storage.local.set({ foundResults });

          if (notifyMode !== "disabled") {
            let message = found.slice(0, 3).map(f => `${f.keyword} @ ${f.url}`).join("\n");
            if (found.length > 3) {
              message += `\n+${found.length - 3} more...`;
            }

            if (notifyMode === "notification") {
              chrome.notifications.create({
                type: "basic",
                iconUrl: "icon.png",
                title: "HTML_search found matches!",
                message: message || `${found.length} matches found.`,
                priority: 2,
                requireInteraction: true
              });
            } else if (notifyMode === "alert") {
              chrome.scripting.executeScript({
                target: { tabId: details.tabId },
                func: (msg) => alert("HTML_search:\n" + msg),
                args: [message]
              });
            }
          }
        }

      } catch (err) {
        console.error("HTML_search autorun error:", err);
      }
    }
  );
});

function findMatches(source, url, keyword, results) {
  const lines = source.split("\n");
  lines.forEach((line, i) => {
    if (line.toLowerCase().includes(keyword.toLowerCase())) {
      results.push({ url, keyword, line: line.trim(), lineNum: i + 1 });
    }
  });
}
