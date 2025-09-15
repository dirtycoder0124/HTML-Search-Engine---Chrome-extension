document.addEventListener("DOMContentLoaded", () => {
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

  // Load saved settings
  chrome.storage.local.get(["keywords", "notifyMode", "maxLinks"], (data) => {
    if (data.notifyMode) notifyModeSelect.value = data.notifyMode;
    if (data.maxLinks) maxLinksSelect.value = data.maxLinks;
  });

  // Save keywords and settings
  saveBtn.addEventListener("click", () => {
    const newKeywords = keywordsInput.value
      ? keywordsInput.value.split(",").map(k => k.trim()).filter(Boolean)
      : [];

    chrome.storage.local.get(["keywords"], (data) => {
      let keywords = data.keywords || [];

      // Merge only if new keywords entered
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

  // Show all found results
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

  // Show all saved keywords with delete button
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

  // Clear all found links
  clearAllBtn.addEventListener("click", () => {
    chrome.storage.local.set({ foundResults: [] }, () => {
      resultsDiv.innerHTML = "";
      status.textContent = "✅ All results cleared!";
      setTimeout(() => status.textContent = "", 2000);
    });
  });
});
