document.addEventListener("DOMContentLoaded", async () => {
  // --- TAB HANDLING ---
  const tabs = document.querySelectorAll(".tab");
  const tabContents = document.querySelectorAll(".tab-content");
  const linksWithParamsDiv = document.getElementById("linksWithParams");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const target = tab.getAttribute("data-tab");

      // Remove active from all tabs & contents
      tabs.forEach(t => t.classList.remove("active"));
      tabContents.forEach(c => c.classList.remove("active"));

      // Add active to selected
      tab.classList.add("active");
      document.getElementById(target).classList.add("active");

      // Auto-fetch when "All Parameter Links" tab is opened
      if (target === "params") {
        fetchLinksWithParams();
      }
    });
  });

  // --- Elements ---
  const keywordsInput = document.getElementById("keywords");
  const notifyModeSelect = document.getElementById("notifyMode");
  const maxLinksSelect = document.getElementById("maxLinks");
  const saveBtn = document.getElementById("save");
  const status = document.getElementById("status");
  const showAllBtn = document.getElementById("showAll");
  const resultsDiv = document.getElementById("results");
  const showKeywordsBtn = document.getElementById("showKeywords");
  const keywordsListDiv = document.getElementById("keywordsList");
  const clearAllBtn = document.getElementById("clearAll");
  const siteToggle = document.getElementById("siteToggle");
  const siteLabel = document.getElementById("siteLabel");

  // --- Get current tab + domain ---
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let currentDomain = "";
  if (tab.url && tab.url.startsWith("http")) {
    currentDomain = new URL(tab.url).hostname;
    siteLabel.textContent = `Turn ON for: ${currentDomain}`;
  }

  // --- Load current activeSites state ---
  chrome.storage.local.get(["activeSites"], (data) => {
    const activeSites = data.activeSites || {};
    siteToggle.checked = !!activeSites[currentDomain];
  });

  // --- Toggle site on/off ---
  siteToggle.addEventListener("change", () => {
    chrome.storage.local.get(["activeSites"], (data) => {
      let activeSites = data.activeSites || {};
      if (siteToggle.checked) {
        activeSites[currentDomain] = true;
      } else {
        delete activeSites[currentDomain];
      }
      chrome.storage.local.set({ activeSites });
    });
  });

  // --- Load saved settings ---
  chrome.storage.local.get(["keywords", "notifyMode", "maxLinks"], (data) => {
    if (data.notifyMode) notifyModeSelect.value = data.notifyMode;
    if (data.maxLinks) maxLinksSelect.value = data.maxLinks;
  });

  // --- Save keywords and settings ---
  saveBtn.addEventListener("click", () => {
    const newKeywords = keywordsInput.value
      ? keywordsInput.value.split(",").map(k => k.trim()).filter(Boolean)
      : [];

    chrome.storage.local.get(["keywords"], (data) => {
      let keywords = data.keywords || [];
      newKeywords.forEach(k => {
        if (!keywords.includes(k)) keywords.push(k);
      });

      const notifyMode = notifyModeSelect.value;
      const maxLinks = maxLinksSelect.value;

      chrome.storage.local.set({ keywords, notifyMode, maxLinks }, () => {
        status.textContent = "Settings saved!";
        status.className = "success";
        keywordsInput.value = "";
        setTimeout(() => {
          status.textContent = "";
          status.className = "";
        }, 2000);
      });
    });
  });

  // --- Show all found results ---
  showAllBtn.addEventListener("click", () => {
    chrome.storage.local.get(["foundResults"], (data) => {
      resultsDiv.innerHTML = "";
      if (!data.foundResults || data.foundResults.length === 0) {
        resultsDiv.textContent = "No results found yet.";
        return;
      }

      function escapeHTML(str) {
        return str
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      }

      const list = document.createElement("ul");
      data.foundResults.forEach(item => {
        const li = document.createElement("li");
        li.innerHTML = `<b>${escapeHTML(item.keyword)}</b> @ 
          <a href="${escapeHTML(item.url)}" target="_blank">${escapeHTML(item.url)}</a> 
          (line ${item.lineNum})<br>`;
        list.appendChild(li);
      });
      resultsDiv.appendChild(list);
    });
  });

  // --- Show all saved keywords with delete button ---
  function displayKeywords() {
    chrome.storage.local.get(["keywords"], (data) => {
      keywordsListDiv.innerHTML = "";
      if (!data.keywords || data.keywords.length === 0) {
        keywordsListDiv.textContent = "No keywords saved.";
        return;
      }

      const list = document.createElement("ul");
      list.style.paddingLeft = "0";
      list.style.listStyle = "none";

      data.keywords.forEach((kw) => {
        const li = document.createElement("li");
        li.style.display = "flex";
        li.style.justifyContent = "space-between";
        li.style.alignItems = "center";
        li.style.marginBottom = "5px";
        li.style.borderBottom = "1px solid #ccc";
        li.style.padding = "2px 0";

        const span = document.createElement("span");
        span.textContent = kw;

        const delBtn = document.createElement("span");
        delBtn.textContent = "X";
        delBtn.style.color = "red";
        delBtn.style.cursor = "pointer";
        delBtn.style.marginLeft = "10px";
        delBtn.style.fontWeight = "bold";
        delBtn.title = "Delete keyword";

        delBtn.addEventListener("click", () => {
          const updatedKeywords = data.keywords.filter(k => k !== kw);
          chrome.storage.local.set({ keywords: updatedKeywords }, () => {
            displayKeywords();
          });
        });

        li.appendChild(span);
        li.appendChild(delBtn);
        list.appendChild(li);
      });

      keywordsListDiv.appendChild(list);
    });
  }
  showKeywordsBtn.addEventListener("click", displayKeywords);

  // --- Clear all found links ---
  clearAllBtn.addEventListener("click", () => {
    chrome.storage.local.set({ foundResults: [] }, () => {
      resultsDiv.innerHTML = "";
      status.textContent = "✅ All results cleared!";
      setTimeout(() => status.textContent = "", 2000);
    });
  });

  // --- Fetch & Show URLs with parameters (internal + filtered) ---
  async function fetchLinksWithParams() {
    linksWithParamsDiv.innerHTML = "Loading...";

    const [{ result: linksWithParams }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const baseDomain = window.location.hostname;
        const result = [];

        // 1. Internal <a> links with ?
        document.querySelectorAll("a[href]").forEach(a => {
          try {
            const urlObj = new URL(a.href, window.location.origin);
            if (urlObj.hostname === baseDomain && urlObj.search) result.push(urlObj.href);
          } catch (e) {}
        });

        // 2. Internal <meta> URLs
        document.querySelectorAll("meta[content]").forEach(meta => {
          try {
            const content = meta.content.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
            const matches = content.match(/https?:\/\/[^\s"']+\?[^\s"']+/g);
            if (matches) {
              matches.forEach(u => {
                const urlObj = new URL(u);
                if (urlObj.hostname === baseDomain) result.push(urlObj.href);
              });
            }
          } catch (e) {}
        });

        // 3. Internal URLs in <script> tags
        document.querySelectorAll("script").forEach(script => {
          try {
            const matches = script.textContent.match(/https?:\/\/[^\s"']+\?[^\s"']+/g);
            if (matches) {
              matches.forEach(u => {
                const urlObj = new URL(u);
                if (urlObj.hostname === baseDomain) result.push(urlObj.href);
              });
            }
          } catch (e) {}
        });

        return [...new Set(result)];
      }
    });

    if (!linksWithParams || linksWithParams.length === 0) {
      linksWithParamsDiv.textContent = "No internal links with parameters found.";
      return;
    }

    // --- Filter out static file types ---
    const ignoredExt = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot'];
    const filteredLinks = linksWithParams.filter(link => {
      try {
        const urlObj = new URL(link);
        return !ignoredExt.some(ext => urlObj.pathname.toLowerCase().endsWith(ext));
      } catch (e) {
        return false;
      }
    });

    if (filteredLinks.length === 0) {
      linksWithParamsDiv.textContent = "No internal links with parameters found after filtering.";
      return;
    }

    // --- Copy All button ---
    const copyBtn = document.createElement("button");
    copyBtn.textContent = "Copy All URLs";
    copyBtn.style.marginBottom = "10px";
   copyBtn.addEventListener("click", () => {
    const decodedLinks = filteredLinks.map(link => {
        try { return decodeURIComponent(link); } 
        catch(e) { return link; }
    });
    navigator.clipboard.writeText(decodedLinks.join("\n")).then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => (copyBtn.textContent = "Copy All URLs"), 2000);
    });
});

    // --- Display filtered links ---
	 const list = document.createElement("div"); 
	filteredLinks.forEach(link => {
	  const card = document.createElement("div");
	  card.className = "result-card";

	  // decode URL for display
	  let decodedLink;
	  try {
		decodedLink = decodeURIComponent(link);
	  } catch(e) {
		decodedLink = link; // fallback if decoding fails
	  }

	   // Create <a> element safely
	  const a = document.createElement("a");
	  a.href = link;              // original encoded link for navigation
	  a.target = "_blank";
	  a.textContent = decodedLink; // decoded link only shown as text (no HTML execution)

	  card.appendChild(a);
	  list.appendChild(card);
	});

    linksWithParamsDiv.innerHTML = "";
    linksWithParamsDiv.appendChild(copyBtn);
    linksWithParamsDiv.appendChild(list);
  }
});
