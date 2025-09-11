chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (!details.url.startsWith("http")) return;

  chrome.storage.local.get(["keywords", "notifyMode", "foundResults", "maxLinks"], async (data) => {
    const keywords = data.keywords || [];
    const notifyMode = data.notifyMode || "notification";
    const maxLinks = data.maxLinks || "10";
    let foundResults = data.foundResults || [];

    if (keywords.length === 0) return;

    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        func: () => {
          const html = document.documentElement.outerHTML;
          const base = window.location.origin;
          const anchors = [...document.querySelectorAll("a[href]")];
          const links = anchors
            .map(a => a.href)
            .filter(h => h.startsWith(base));
          return { html, links: [...new Set(links)] };
        }
      });

      let found = [];

      // Search current page
      for (let kw of keywords) {
        findMatches(result.html, details.url, kw, found);
      }

      // Determine how many links to scan
      const linkLimit = maxLinks === "all" ? result.links.length : parseInt(maxLinks);

      for (let i = 0; i < Math.min(result.links.length, linkLimit); i++) {
        try {
          let res = await fetch(result.links[i]);
          let text = await res.text();
          for (let kw of keywords) {
            findMatches(text, result.links[i], kw, found);
          }
        } catch (e) {
          console.error("dirty_search fetch failed:", result.links[i], e);
        }
      }

      if (found.length > 0) {
        // Remove duplicates
        found.forEach(f => {
          if (!foundResults.some(r => r.url === f.url && r.keyword === f.keyword && r.lineNum === f.lineNum)) {
            foundResults.push(f);
          }
        });

        chrome.storage.local.set({ foundResults });

        if (notifyMode !== "disabled") {
          let message = found.slice(0, 3).map(f => `${f.keyword} @ ${f.url}`).join("\n");
          if (notifyMode === "notification") {
            chrome.notifications.create({
              type: "basic",
              iconUrl: "icon.png",
              title: "dirty_search found matches!",
              message: message || `${found.length} matches found.`,
              priority: 2,
              requireInteraction: true
            });
          } else if (notifyMode === "alert") {
            chrome.scripting.executeScript({
              target: { tabId: details.tabId },
              func: (msg) => alert("dirty_search:\n" + msg),
              args: [message]
            });
          }
        }
      }

    } catch (err) {
      console.error("dirty_search autorun error:", err);
    }
  });
});

function findMatches(source, url, keyword, results) {
  const lines = source.split("\n");
  lines.forEach((line, i) => {
    if (line.toLowerCase().includes(keyword.toLowerCase())) {
      results.push({ url, keyword, line: line.trim(), lineNum: i + 1 });
    }
  });
}
