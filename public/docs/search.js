"use strict";
/* 文档站搜索（与 index.html 的查看器配合，无依赖）：
 * - 懒建索引：首次搜索才拉取 DOCS 清单里全部 .md（含 api.md），按 Markdown
 *   标题切成小节；API 参考的每个声明即一个小节，天然可搜；
 * - 标题命中排在正文命中前，正文命中给单行摘要并高亮关键词；
 * - 点击结果跳转目标页，渲染完成后滚动到对应章节并短暂高亮
 *   （经 window.__docsConsumeScroll 钩子由查看器回调）。
 * 快捷键：Ctrl+K / / 聚焦，↑↓ 选择，Enter 打开，Esc 关闭。 */
(function () {
  var MAX_RESULTS = 30;
  var SNIPPET = 60;

  var box = document.getElementById("searchBox");
  var list = document.getElementById("srList");
  var pages = [];
  var index = null; // 小节数组：{ path, crumb, heading, bodyLower, bodyRaw }
  var building = false;
  var results = [];
  var active = -1;
  var pendingScroll = null;

  DOCS.forEach(function (g) {
    g.items.forEach(function (it) {
      pages.push({ path: g.base + it[0], title: it[1], group: g.group });
    });
  });

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /** Markdown 文本 → 小节列表（# 系标题分行，标题间的正文归属最近标题） */
  function splitSections(page, text) {
    var out = [];
    var h1 = page.title, h2 = "";
    var cur = { path: page.path, crumb: "", heading: page.title, lines: [] };
    var flush = function () {
      cur.crumb = h2 && cur.heading !== h2 ? h2 : "";
      out.push(cur);
    };
    text.split("\n").forEach(function (ln) {
      var m = /^(#{1,6})\s+(.+?)\s*$/.exec(ln);
      if (m) {
        flush();
        if (m[1].length === 1) h1 = m[2];
        if (m[1].length === 2) h2 = m[2];
        cur = { path: page.path, crumb: m[1].length > 2 ? h2 : "", heading: m[2], lines: [] };
      } else {
        cur.lines.push(ln);
      }
    });
    flush();
    return out.map(function (s) {
      var raw = s.lines.join("\n");
      return { path: s.path, crumb: s.crumb, heading: s.heading, bodyRaw: raw, bodyLower: raw.toLowerCase() };
    });
  }

  function buildIndex() {
    if (index || building) return Promise.resolve();
    building = true;
    return Promise.all(
      pages.map(function (p) {
        return fetch("./" + p.path + ".md")
          .then(function (r) { return r.ok ? r.text() : ""; })
          .then(function (t) { return { page: p, text: t }; });
      })
    ).then(function (pairs) {
      index = [];
      pairs.forEach(function (it) {
        if (it.text) index = index.concat(splitSections(it.page, it.text));
      });
    });
  }

  /** 正文首个命中处的单行摘要（转义后高亮关键词） */
  function renderSnippet(sec, q) {
    var at = sec.bodyLower.indexOf(q);
    if (at === -1) return "";
    var start = Math.max(0, at - SNIPPET / 2);
    var frag = sec.bodyRaw.slice(start, at + q.length + SNIPPET).replace(/\s+/g, " ").trim();
    var low = frag.toLowerCase();
    var first = low.indexOf(q);
    var out = esc(frag.slice(0, first)) + "<mark>" + esc(frag.slice(first, first + q.length)) + "</mark>" + esc(frag.slice(first + q.length));
    return (start > 0 ? "…" : "") + out + "…";
  }

  function search(q) {
    var hits = [];
    for (var i = 0; i < index.length && hits.length < MAX_RESULTS * 3; i++) {
      var sec = index[i];
      var head = sec.heading.toLowerCase();
      var score = -1;
      if (head.indexOf(q) !== -1) score = 200 - head.indexOf(q);
      else {
        var n = 0, at = 0;
        while ((at = sec.bodyLower.indexOf(q, at)) !== -1 && n < 5) { n++; at += q.length; }
        if (n > 0) score = 20 + n;
      }
      if (score > 0) hits.push({ sec: sec, score: score });
    }
    hits.sort(function (a, b) { return b.score - a.score; });
    return hits.slice(0, MAX_RESULTS).map(function (h) { return h.sec; });
  }

  function label(sec) {
    var page = pages.find(function (p) { return p.path === sec.path; });
    var parts = [page ? page.title : sec.path];
    if (sec.crumb && sec.crumb !== sec.heading) parts.push(sec.crumb);
    if (sec.heading && sec.heading !== parts[parts.length - 1]) parts.push(sec.heading);
    return parts.join(" › ");
  }

  function open(sec) {
    pendingScroll = sec;
    close();
    location.hash = "#" + sec.path;
  }

  function render() {
    if (!results.length) {
      list.innerHTML = '<div class="sr-empty">无匹配结果</div>';
    } else {
      var q = box.value.trim().toLowerCase();
      list.innerHTML = results
        .map(function (sec, i) {
          var body = renderSnippet(sec, q);
          return (
            '<div class="sr-item' + (i === active ? " active" : "") + '" data-i="' + i + '">' +
            '<div class="sr-crumb">' + esc(label(sec)) + "</div>" +
            (body ? '<div class="sr-snippet">' + body + "</div>" : "") +
            "</div>"
          );
        })
        .join("") + '<div class="sr-hint">↑↓ 选择 · Enter 打开 · Esc 关闭</div>';
    }
    list.classList.add("open");
  }

  function run() {
    var q = box.value.trim().toLowerCase();
    if (!q) { close(); return; }
    buildIndex().then(function () {
      if (box.value.trim().toLowerCase() !== q) return; // 输入已变化，丢弃过期结果
      results = search(q);
      active = results.length ? 0 : -1;
      render();
    });
  }

  function close() {
    list.classList.remove("open");
    active = -1;
  }

  // 查看器渲染完成后的滚动回调：搜索跳转的章节滚动定位 + 短暂高亮
  window.__docsConsumeScroll = function () {
    if (!pendingScroll) return;
    var target = pendingScroll;
    pendingScroll = null;
    var nodes = document.querySelectorAll("#md h1, #md h2, #md h3, #md h4, #md h5, #md h6");
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].textContent.trim() === target.heading) {
        nodes[i].scrollIntoView({ block: "start" });
        nodes[i].classList.add("search-hit");
        setTimeout(function (el) { return function () { el.classList.remove("search-hit"); }; }(nodes[i]), 1600);
        break;
      }
    }
  };

  box.addEventListener("input", function () {
    clearTimeout(box._t);
    box._t = setTimeout(run, 140);
  });
  box.addEventListener("focus", run);
  box.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { close(); box.blur(); return; }
    if (!results.length) return;
    if (e.key === "ArrowDown") { active = (active + 1) % results.length; render(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = (active - 1 + results.length) % results.length; render(); e.preventDefault(); }
    else if (e.key === "Enter" && active >= 0) { open(results[active]); }
  });
  list.addEventListener("click", function (e) {
    var item = e.target.closest(".sr-item");
    if (item) open(results[Number(item.dataset.i)]);
  });
  document.addEventListener("mousedown", function (e) {
    if (!list.contains(e.target) && e.target !== box) close();
  });
  document.addEventListener("keydown", function (e) {
    var tag = document.activeElement && document.activeElement.tagName;
    if ((e.ctrlKey && e.key.toLowerCase() === "k") || (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA")) {
      e.preventDefault();
      box.focus();
      box.select();
    }
  });
})();
