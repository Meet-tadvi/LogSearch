"""
Log Search — Streamlit UI
=========================
Dark theme is handled by .streamlit/config.toml — NOT by CSS hacks.
CSS here is only for custom visual components (chips, cards, etc).

Pages:
    upload    — drag & drop log file
    parsing   — animated progress through parse steps
    dashboard — sidebar filters + summary chips + table + LLM
    summary   — full file statistics (separate page)
"""

import streamlit as st
import pandas as pd
import json
import tempfile
import os
import time

from log_parser import LogParser
from search_operations import SearchOperations

# ================================================================
# Page config
# ================================================================

st.set_page_config(
    page_title            = "Log Search",
    page_icon             = "🔍",
    layout                = "wide",
    initial_sidebar_state = "expanded",
)

# ================================================================
# CSS — ONLY for custom components, not for overriding Streamlit
# The dark theme colors come from .streamlit/config.toml
# ================================================================

st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap');

/* ── Hide only the deploy/share button, keep sidebar toggle ── */
.stDeployButton        { display: none !important; }
#MainMenu              { display: none !important; }
footer                 { display: none !important; }

/* ── Monospace font for log content ── */
.mono { font-family: 'JetBrains Mono', monospace !important; }

/* ── Header card ── */
.header-card {
    background: #161b22;
    border: 1px solid #30363d;
    border-left: 3px solid #f0a500;
    border-radius: 8px;
    padding: 14px 20px;
    margin-bottom: 10px;
}
.header-filename {
    font-family: 'JetBrains Mono', monospace;
    font-size: 15px;
    font-weight: 700;
    color: #f0a500;
}
.header-meta {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: #8b949e;
    margin-top: 5px;
}
.header-meta b { color: #e6edf3; }

/* ── Status chips ── */
.chip {
    display: inline-block;
    border-radius: 5px;
    padding: 3px 10px;
    margin: 2px 3px 2px 0;
    font-size: 12px;
    font-weight: 600;
    font-family: 'JetBrains Mono', monospace;
    background: #21262d;
    color: #e6edf3;
    border: 1px solid #30363d;
}
.chip-ERROR   { background: rgba(248,81,73,0.12);  color: #f85149; border-color: rgba(248,81,73,0.35); }
.chip-WARNING { background: rgba(210,153,34,0.12); color: #d29922; border-color: rgba(210,153,34,0.35); }
.chip-INFO    { background: rgba(88,166,255,0.12); color: #58a6ff; border-color: rgba(88,166,255,0.35); }
.chip-DEBUG   { background: rgba(63,185,80,0.12);  color: #3fb950; border-color: rgba(63,185,80,0.35); }
.chip-line    { background: rgba(188,140,255,0.12);color: #bc8cff; border-color: rgba(188,140,255,0.35); }
.chip-time    { background: rgba(57,211,187,0.12); color: #39d3bb; border-color: rgba(57,211,187,0.35); }
.chip-thread  { background: rgba(240,165,0,0.12);  color: #f0a500; border-color: rgba(240,165,0,0.35); }

/* ── Section micro-label ── */
.sec-label {
    font-size: 10px;
    font-weight: 700;
    color: #484f58;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin: 12px 0 5px 0;
    font-family: 'JetBrains Mono', monospace;
}

/* ── Upload hero ── */
.upload-hero {
    text-align: center;
    padding: 80px 20px 50px;
}
.upload-title {
    font-family: 'JetBrains Mono', monospace;
    font-size: 38px;
    font-weight: 700;
    color: #f0a500;
    letter-spacing: -0.03em;
    margin-bottom: 8px;
}
.upload-sub {
    font-size: 15px;
    color: #8b949e;
    margin-bottom: 36px;
}

/* ── Summary page ── */
.summary-header {
    background: #161b22;
    border: 1px solid #30363d;
    border-left: 3px solid #f0a500;
    border-radius: 8px;
    padding: 18px 22px;
    margin-bottom: 20px;
}
.summary-title {
    font-family: 'JetBrains Mono', monospace;
    font-size: 20px;
    font-weight: 700;
    color: #f0a500;
}
.summary-sub {
    font-size: 13px;
    color: #8b949e;
    margin-top: 4px;
}
.stat-card {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 16px 18px;
    margin-bottom: 4px;
    text-align: center;
}
.stat-label {
    font-size: 10px;
    font-weight: 700;
    color: #484f58;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-family: 'JetBrains Mono', monospace;
    margin-bottom: 6px;
}
.stat-value {
    font-family: 'JetBrains Mono', monospace;
    font-size: 22px;
    font-weight: 700;
    color: #f0a500;
}
.stat-sub {
    font-size: 11px;
    color: #8b949e;
    margin-top: 2px;
}

/* ── Apply button styling ── */
div[data-testid="stSidebar"] .apply-wrap button {
    background: linear-gradient(135deg, #f0a500, #e36209) !important;
    color: #0e1117 !important;
    border: none !important;
    font-weight: 700 !important;
    font-size: 14px !important;
    width: 100% !important;
}
</style>
""", unsafe_allow_html=True)

# ================================================================
# Session state
# ================================================================

def init_state():
    defaults = {
        'page':                 'upload',
        'search_ops':           None,
        'log_metadata':         None,
        'filename':             None,
        'tmp_path':             None,
        'all_logs_json':        None,
        'show_extra':           False,
        'show_llm':             False,
        'llm_history':          [],
        'applied_filters':      {},
        # Fix 3 — unparsed line visibility
        'unparsed_lines':       [],
        'parse_rate':           100.0,
        'show_unparsed':        False,
        # Fix 4 — detection confidence
        'detection_confidence': 0.0,
        # Fix 6 — pagination
        'result_page':          0,
        'page_size':            500,
    }
    for k, v in defaults.items():
        if k not in st.session_state:
            st.session_state[k] = v

init_state()

# ================================================================
# PAGE 1 — Upload
# ================================================================

def upload_page():
    st.markdown("""
    <div class="upload-hero">
        <div class="upload-title">// log_search</div>
        <div class="upload-sub">Upload a log file to parse, filter, and explore its contents</div>
    </div>
    """, unsafe_allow_html=True)

    c1, c2, c3 = st.columns([1, 2, 1])
    with c2:
        uploaded = st.file_uploader(
            "Drop your log file here, or click to browse",
            type=['txt', 'log', 'out'],
        )
        if uploaded is not None:
            suffix = os.path.splitext(uploaded.name)[1] or '.txt'
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(uploaded.read())
                tmp_path = tmp.name
            st.session_state['tmp_path'] = tmp_path
            st.session_state['filename'] = uploaded.name
            st.session_state['page']     = 'parsing'
            st.rerun()

# ================================================================
# PAGE 2 — Parsing progress
# ================================================================

def parsing_page():
    st.markdown(
        f"## ⚙️ Processing Log File\n\n"
        f"<span class='mono' style='color:#8b949e'>▸ {st.session_state['filename']}</span>",
        unsafe_allow_html=True
    )
    st.divider()

    progress_bar  = st.progress(0)
    status_text   = st.empty()
    steps_display = st.empty()
    completed     = []

    def step(msg: str, pct: int, delay: float = 0.25):
        status_text.markdown(
            f"<span class='mono' style='color:#f0a500'>⟳ {msg}…</span>",
            unsafe_allow_html=True
        )
        progress_bar.progress(pct)
        time.sleep(delay)
        completed.append(f"✅ &nbsp;`{msg}`")
        steps_display.markdown("<br>".join(completed), unsafe_allow_html=True)

    try:
        step("Reading file", 10)
        parser = LogParser()
        with open(st.session_state['tmp_path'], 'r',
                  encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()

        step("Detecting log format", 25)
        fmt = parser.detect_format(lines)
        if not fmt:
            confidence = parser.detection_confidence
            st.error(
                f"❌ Could not detect log format "
                f"(best match rate: {confidence:.1f}% — need ≥30%). "
                f"Please check the file or add a custom format."
            )
            if st.button("← Back"):
                st.session_state['page'] = 'upload'
                st.rerun()
            return

        confidence = parser.detection_confidence
        completed.append(
            f"📋 &nbsp;Format: **{fmt}** "
            f"&nbsp;|&nbsp; confidence: **{confidence:.1f}%** "
            f"&nbsp;|&nbsp; {len(lines):,} raw lines"
        )
        steps_display.markdown("<br>".join(completed), unsafe_allow_html=True)

        step("Parsing log entries", 55, delay=0.1)
        parser.parse_file(st.session_state['tmp_path'])

        parsed_count   = len(parser.parsed_logs)
        unparsed_count = len(parser.unparsed_lines)
        total_lines    = len(lines)
        parse_rate     = (parsed_count / total_lines * 100) if total_lines else 100.0

        completed.append(
            f"📝 &nbsp;Parsed **{parsed_count:,}** entries &nbsp;|&nbsp; "
            f"Unparsed: **{unparsed_count:,}** lines &nbsp;|&nbsp; "
            f"Parse rate: **{parse_rate:.1f}%**"
        )
        steps_display.markdown("<br>".join(completed), unsafe_allow_html=True)

        step("Building search indices", 80)
        log_metadata = parser.get_log_metadata()
        search_ops   = SearchOperations(
            logs             = parser.parsed_logs,
            available_fields = log_metadata.get('available_fields', [])
        )

        step("Serializing full log for export", 90, delay=0.1)
        all_logs_json = json.dumps(
            [log.to_dict() for log in parser.parsed_logs],
            indent=2, default=str
        )

        step("Finalizing", 98, delay=0.1)
        progress_bar.progress(100)
        status_text.markdown(
            "<span class='mono' style='color:#3fb950;font-weight:700'>✓ Ready</span>",
            unsafe_allow_html=True
        )
        time.sleep(0.3)

        st.session_state['search_ops']           = search_ops
        st.session_state['log_metadata']         = log_metadata
        st.session_state['all_logs_json']        = all_logs_json
        st.session_state['applied_filters']      = {}
        st.session_state['unparsed_lines']       = parser.unparsed_lines
        st.session_state['parse_rate']           = round(parse_rate, 1)
        st.session_state['detection_confidence'] = parser.detection_confidence
        st.session_state['result_page']          = 0
        st.session_state['page']                 = 'dashboard'
        st.rerun()

    except Exception as e:
        st.error(f"❌ Error during parsing: {e}")
        if st.button("← Back"):
            st.session_state['page'] = 'upload'
            st.rerun()

# ================================================================
# PAGE 3 — Dashboard
# ================================================================

def dashboard_page():
    ops:  SearchOperations = st.session_state['search_ops']
    meta: dict             = st.session_state['log_metadata']
    available = set(meta.get('available_fields', []))
    af        = st.session_state['applied_filters']

    # ── Sidebar: Filters ─────────────────────────────────────────
    with st.sidebar:
        st.markdown(
            "<span class='mono' style='font-size:16px;font-weight:700;"
            "color:#f0a500'>// filters</span>",
            unsafe_allow_html=True
        )
        st.markdown("")

        text_search = st.text_input(
            "Text Search",
            placeholder = "Search in raw log line…",
            value       = af.get('text', ''),
        )

        level_filter = []
        if 'level' in available:
            level_filter = st.multiselect(
                "Level",
                options = meta.get('levels', []),
                default = af.get('levels', []),
            )

        comp_filter = []
        if 'component' in available:
            comp_filter = st.multiselect(
                "Component",
                options = meta.get('components', []),
                default = af.get('components', []),
            )

        thread_filter = []
        if 'thread_id' in available:
            thread_filter = st.multiselect(
                "Thread ID",
                options = meta.get('thread_ids', []),
                default = af.get('threads', []),
            )

        file_filter = ""
        if 'file_path' in available:
            file_filter = st.text_input(
                "Source File",
                placeholder = "e.g. nvramserialiser",
                value       = af.get('file', ''),
            )

        st.markdown("**Time Range**")
        tc1, tc2 = st.columns(2)
        with tc1:
            start_time = st.text_input(
                "From", placeholder="08:35",
                value = af.get('time_start', ''),
            )
        with tc2:
            end_time = st.text_input(
                "To", placeholder="09:00",
                value = af.get('time_end', ''),
            )

        st.markdown("**Line Number Range**")
        lc1, lc2 = st.columns(2)
        with lc1:
            line_start = st.text_input(
                "From Line", placeholder="1",
                value = af.get('line_start', ''),
            )
        with lc2:
            line_end = st.text_input(
                "To Line", placeholder="5000",
                value = af.get('line_end', ''),
            )

        st.markdown("")

        # ── Apply button ──────────────────────────────────────────
        if st.button("⚡ Apply Filters", type="primary", use_container_width=True):
            st.session_state['applied_filters'] = {
                'text':       text_search,
                'levels':     level_filter,
                'components': comp_filter,
                'threads':    thread_filter,
                'file':       file_filter,
                'time_start': start_time,
                'time_end':   end_time,
                'line_start': line_start,
                'line_end':   line_end,
            }
            st.session_state['result_page'] = 0   # Fix 6: reset page on new filter
            st.rerun()

        if st.button("🗑  Clear All Filters", use_container_width=True):
            st.session_state['applied_filters'] = {}
            st.session_state['result_page'] = 0   # Fix 6: reset page on clear
            st.rerun()

        st.divider()

        # ── Fix 3: Parse health ───────────────────────────────────
        parse_rate  = st.session_state.get('parse_rate', 100.0)
        confidence  = st.session_state.get('detection_confidence', 0.0)
        unparsed    = st.session_state.get('unparsed_lines', [])
        rate_color  = '#f85149' if parse_rate < 80 else '#d29922' if parse_rate < 95 else '#3fb950'
        st.markdown(
            f"<span class='mono' style='font-size:11px;color:#484f58'>PARSE HEALTH</span><br>"
            f"<span style='color:{rate_color};font-weight:700'>{parse_rate:.1f}% parsed</span>"
            f"<span style='color:#8b949e;font-size:11px'> · fmt confidence {confidence:.1f}%</span>",
            unsafe_allow_html=True
        )
        if unparsed:
            if st.button(
                f"⚠️ Show unparsed lines ({len(unparsed):,})",
                use_container_width=True
            ):
                st.session_state['show_unparsed'] = not st.session_state.get('show_unparsed', False)
                st.rerun()

        st.divider()

        if st.button("📊 View Summary", use_container_width=True):
            st.session_state['page'] = 'summary'
            st.rerun()

        if st.button("📂 Load New File", use_container_width=True):
            _reset_and_go_upload()

    # ── Run search from applied_filters snapshot ──────────────────
    af = st.session_state['applied_filters']

    line_start_int, line_end_int = None, None
    try:
        if af.get('line_start'): line_start_int = int(af['line_start'])
    except ValueError: pass
    try:
        if af.get('line_end'):   line_end_int   = int(af['line_end'])
    except ValueError: pass

    raw_matches = ops.find_combined(
        search_string = af.get('text')       or None,
        levels        = af.get('levels')     or None,
        components    = af.get('components') or None,
        thread_ids    = af.get('threads')    or None,
        source_file   = af.get('file')       or None,
        start_time    = af.get('time_start') or None,
        end_time      = af.get('time_end')   or None,
    )

    if line_start_int is not None or line_end_int is not None:
        matches = [
            m for m in raw_matches
            if (line_start_int is None or m['actual_line_number'] >= line_start_int)
            and (line_end_int  is None or m['actual_line_number'] <= line_end_int)
        ]
    else:
        matches = raw_matches

    match_summary = ops.build_match_summary(matches) if matches else {}

    # ── Header ────────────────────────────────────────────────────
    h_col, btn_extra, btn_json = st.columns([6, 1, 1])

    with h_col:
        st.markdown(f"""
        <div class="header-card">
            <div class="header-filename">📄 {st.session_state['filename']}</div>
            <div class="header-meta">
                Format: <b>{meta.get('format_name','?')}</b>
                &nbsp;·&nbsp; Total: <b>{len(ops.logs):,}</b> entries
                &nbsp;·&nbsp; Fields: {', '.join(sorted(available))}
                &nbsp;·&nbsp; Detection: <b>{st.session_state.get('detection_confidence', 0):.1f}%</b>
                &nbsp;·&nbsp; Parse rate: <b>{st.session_state.get('parse_rate', 100):.1f}%</b>
            </div>
        </div>
        """, unsafe_allow_html=True)

    with btn_extra:
        st.write("")
        if st.button("📎 Extra", use_container_width=True):
            st.session_state['show_extra'] = not st.session_state['show_extra']

    with btn_json:
        st.write("")
        st.download_button(
            label     = "⬇ JSON",
            data      = st.session_state['all_logs_json'],
            file_name = f"{st.session_state['filename']}_full.json",
            mime      = "application/json",
            use_container_width = True,
        )

    # ── Extra Fields panel ────────────────────────────────────────
    if st.session_state['show_extra']:
        with st.expander("📎 Extra Fields", expanded=True):
            extra_all = ops.get_all_extra_fields()
            if extra_all:
                for fname, values in extra_all.items():
                    st.markdown(f"**{fname}** — {len(values)} unique values")
                    st.dataframe(
                        pd.DataFrame(list(values.items())[:15],
                                     columns=['Value', 'Count']),
                        hide_index=True,
                    )
            else:
                st.info("No extra fields in this log format.")

    # ── Active filter tags ────────────────────────────────────────
    if af:
        tags = []
        if af.get('text'):       tags.append(f"text='{af['text']}'")
        if af.get('levels'):     tags.append(f"level={af['levels']}")
        if af.get('components'): tags.append(f"component={af['components']}")
        if af.get('threads'):    tags.append(f"thread={af['threads']}")
        if af.get('file'):       tags.append(f"file='{af['file']}'")
        if af.get('time_start'): tags.append(f"from={af['time_start']}")
        if af.get('time_end'):   tags.append(f"to={af['time_end']}")
        if af.get('line_start'): tags.append(f"line≥{af['line_start']}")
        if af.get('line_end'):   tags.append(f"line≤{af['line_end']}")
        if tags:
            html = " ".join(f"<span class='chip'>{t}</span>" for t in tags)
            st.markdown(
                f"<div style='margin-bottom:8px'>🔎 Active filters: {html}</div>",
                unsafe_allow_html=True
            )
    else:
        st.caption("No filters applied — showing all entries. Use the sidebar to filter.")

    # ── Fix 3: Unparsed lines panel ───────────────────────────────
    if st.session_state.get('show_unparsed') and st.session_state.get('unparsed_lines'):
        unparsed = st.session_state['unparsed_lines']
        with st.expander(f"⚠️ Unparsed Lines ({len(unparsed):,}) — these lines did not match the detected format", expanded=True):
            df_up = pd.DataFrame(unparsed)  # columns: line_number, content
            st.dataframe(df_up, hide_index=True, height=260,
                         column_config={
                             'line_number': st.column_config.NumberColumn('Line', width='small'),
                             'content':     st.column_config.TextColumn('Raw Content', width='large'),
                         })
            st.download_button(
                label     = "📥 Download Unparsed Lines",
                data      = df_up.to_csv(index=False),
                file_name = f"unparsed_{st.session_state['filename']}.csv",
                mime      = "text/csv",
            )

    # ── Filtered Result Summary ───────────────────────────────────
    with st.container(border=True):
        if not matches:
            st.markdown(
                "<span style='color:#8b949e'>No results match the current filters.</span>",
                unsafe_allow_html=True
            )
        else:
            total   = match_summary.get('total', 0)
            tr      = match_summary.get('time_range', {})
            lr      = match_summary.get('line_range', {})
            t_start = (tr.get('first') or '')[:19]
            t_end   = (tr.get('last')  or '')[:19]

            st.markdown(
                f"<span class='chip'>🔢 {total:,} matches</span>"
                f"<span class='chip chip-line'>📍 Lines {lr.get('first','?')} → {lr.get('last','?')}</span>"
                f"<span class='chip chip-time'>🕐 {t_start} → {t_end}</span>",
                unsafe_allow_html=True,
            )

            if match_summary.get('levels'):
                st.markdown("<div class='sec-label'>Levels</div>", unsafe_allow_html=True)
                html = "".join(
                    f"<span class='chip chip-{lvl}'>{lvl}: {cnt:,} ({cnt/total*100:.1f}%)</span> "
                    for lvl, cnt in sorted(
                        match_summary['levels'].items(), key=lambda x: -x[1])
                )
                st.markdown(html, unsafe_allow_html=True)

            if match_summary.get('components'):
                st.markdown("<div class='sec-label'>Components</div>", unsafe_allow_html=True)
                html = "".join(
                    f"<span class='chip'>{c}: {n:,}</span> "
                    for c, n in list(sorted(
                        match_summary['components'].items(),
                        key=lambda x: -x[1]))[:8]
                )
                st.markdown(html, unsafe_allow_html=True)

            if match_summary.get('threads'):
                st.markdown("<div class='sec-label'>Threads</div>", unsafe_allow_html=True)
                html = "".join(
                    f"<span class='chip chip-thread'>🧵 {t}: {n:,}</span> "
                    for t, n in list(sorted(
                        match_summary['threads'].items(),
                        key=lambda x: -x[1]))[:6]
                )
                st.markdown(html, unsafe_allow_html=True)

            if match_summary.get('extra_fields'):
                st.markdown("<div class='sec-label'>Extra Fields</div>", unsafe_allow_html=True)
                html = "".join(
                    "<span class='chip'>📎 {}: {}</span> ".format(
                        fn,
                        ", ".join(f"{v}({c})" for v, c in list(vs.items())[:3])
                    )
                    for fn, vs in list(match_summary['extra_fields'].items())[:3]
                )
                st.markdown(html, unsafe_allow_html=True)

    # ── Results Table with Pagination ────────────────────────────
    with st.container(border=True):
        if matches:
            total_matches = len(matches)
            page_size     = st.session_state.get('page_size', 500)
            total_pages   = max(1, (total_matches + page_size - 1) // page_size)
            current_page  = min(st.session_state.get('result_page', 0), total_pages - 1)

            page_start  = current_page * page_size
            page_end    = min(page_start + page_size, total_matches)
            page_matches = matches[page_start:page_end]

            # ── Pagination controls ───────────────────────────────
            pc1, pc2, pc3, pc4 = st.columns([1, 3, 1, 2])
            with pc1:
                if st.button("◀ Prev", disabled=(current_page == 0), use_container_width=True):
                    st.session_state['result_page'] = current_page - 1
                    st.rerun()
            with pc2:
                st.markdown(
                    f"<div style='text-align:center;padding-top:6px'>"
                    f"<span class='mono' style='font-size:13px;color:#8b949e'>"
                    f"Rows {page_start+1:,}–{page_end:,} of {total_matches:,} "
                    f"&nbsp;·&nbsp; Page {current_page+1} of {total_pages}"
                    f"</span></div>",
                    unsafe_allow_html=True
                )
            with pc3:
                if st.button("Next ▶", disabled=(current_page >= total_pages - 1), use_container_width=True):
                    st.session_state['result_page'] = current_page + 1
                    st.rerun()
            with pc4:
                new_size = st.selectbox(
                    "Rows/page", [100, 250, 500, 1000],
                    index=[100, 250, 500, 1000].index(page_size) if page_size in [100,250,500,1000] else 2,
                    label_visibility='collapsed'
                )
                if new_size != page_size:
                    st.session_state['page_size']   = new_size
                    st.session_state['result_page'] = 0
                    st.rerun()

            df = build_display_dataframe(page_matches, available)
            st.dataframe(
                df,
                hide_index    = True,
                height        = 440,
                column_config = build_column_config(available),
            )

            # Download exports the FULL filtered set, not just current page
            full_df = build_display_dataframe(matches, available)
            st.download_button(
                label     = f"📥 Download All {total_matches:,} Filtered Rows (CSV)",
                data      = full_df.to_csv(index=False),
                file_name = f"filtered_{st.session_state['filename']}.csv",
                mime      = "text/csv",
            )
        else:
            st.markdown(
                "<span style='color:#8b949e'>No results to display.</span>",
                unsafe_allow_html=True
            )

    # ── LLM Button + Panel ────────────────────────────────────────
    st.write("")
    _, llm_btn_col = st.columns([9, 1])
    with llm_btn_col:
        if st.button("🤖 LLM", use_container_width=True):
            st.session_state['show_llm'] = not st.session_state['show_llm']

    if st.session_state['show_llm']:
        render_llm_panel(matches, match_summary)


# ================================================================
# PAGE 4 — Summary (separate page)
# ================================================================

def summary_page():
    ops:  SearchOperations = st.session_state['search_ops']
    meta: dict             = st.session_state['log_metadata']
    available = set(meta.get('available_fields', []))

    if st.button("← Back to Dashboard"):
        st.session_state['page'] = 'dashboard'
        st.rerun()

    st.markdown(f"""
    <div class="summary-header">
        <div class="summary-title">📊 Log File Summary</div>
        <div class="summary-sub">
            {st.session_state['filename']}
            &nbsp;·&nbsp; Format: <b style="color:#f0a500">{meta.get('format_name','?')}</b>
        </div>
    </div>
    """, unsafe_allow_html=True)

    summary = ops.get_summary()
    total   = summary.get('total_entries', 0)
    tr      = summary.get('time_range', {})

    # ── Stat cards row ────────────────────────────────────────────
    sc = st.columns(4)
    cards = [
        ("TOTAL ENTRIES", f"{total:,}",                      "log entries parsed"),
        ("FORMAT",        meta.get('format_name','?'),        "detected format"),
        ("TIME START",    (tr.get('start') or 'N/A')[:19],   "first entry"),
        ("TIME END",      (tr.get('end')   or 'N/A')[:19],   "last entry"),
    ]
    for col, (label, value, sub) in zip(sc, cards):
        with col:
            st.markdown(f"""
            <div class="stat-card">
                <div class="stat-label">{label}</div>
                <div class="stat-value" style="font-size:16px">{value}</div>
                <div class="stat-sub">{sub}</div>
            </div>
            """, unsafe_allow_html=True)

    st.markdown("")

    # ── Levels ────────────────────────────────────────────────────
    if 'levels' in summary:
        with st.container(border=True):
            st.markdown("### 📊 Log Levels")
            lvl = summary['levels']
            mc  = st.columns(3)
            mc[0].metric("❌ Errors",   f"{lvl['errors']:,}")
            mc[1].metric("⚠️ Warnings", f"{lvl['warnings']:,}")
            mc[2].metric("ℹ️ Info",     f"{lvl.get('info',0):,}")

            if lvl['distribution']:
                df_lvl = pd.DataFrame(
                    list(lvl['distribution'].items()),
                    columns=['Level', 'Count']
                )
                df_lvl['%'] = (df_lvl['Count'] / total * 100).round(2)
                df_lvl = df_lvl.sort_values('Count', ascending=False)
                st.dataframe(df_lvl, hide_index=True)

            if summary.get('error_samples'):
                st.markdown("**Sample Errors:**")
                for e in summary['error_samples'][:5]:
                    st.markdown(
                        f"<span class='mono' style='font-size:12px;color:#f85149'>"
                        f"L{e.get('actual_line_number','?')} — "
                        f"{e.get('message','')[:120]}</span>",
                        unsafe_allow_html=True
                    )

    # ── Components + Threads ──────────────────────────────────────
    col_a, col_b = st.columns(2)

    with col_a:
        if 'components' in summary:
            with st.container(border=True):
                st.markdown("### 🔧 Components")
                comps = summary['components']
                st.markdown(
                    f"<span class='chip'>{comps['total']} unique</span>"
                    f"<span class='chip'>Top: {comps['top']}</span>",
                    unsafe_allow_html=True
                )
                st.markdown("")
                if comps['distribution']:
                    df_c = pd.DataFrame(
                        list(comps['distribution'].items()),
                        columns=['Component', 'Count']
                    )
                    df_c['%'] = (df_c['Count'] / total * 100).round(1)
                    st.dataframe(df_c, hide_index=True)

    with col_b:
        if 'threads' in summary:
            with st.container(border=True):
                st.markdown("### 🧵 Threads")
                threads = summary['threads']
                st.markdown(
                    f"<span class='chip'>{threads['total']} unique threads</span>",
                    unsafe_allow_html=True
                )
                st.markdown("")
                if threads['distribution']:
                    df_t = pd.DataFrame(
                        list(threads['distribution'].items()),
                        columns=['Thread ID', 'Count']
                    )
                    st.dataframe(df_t, hide_index=True)

    # ── Source files ──────────────────────────────────────────────
    if 'files' in summary:
        with st.container(border=True):
            st.markdown("### 📁 Top Source Files")
            df_f = pd.DataFrame(
                list(summary['files']['top'].items()),
                columns=['File', 'Count']
            )
            df_f['%'] = (df_f['Count'] / total * 100).round(2)
            st.dataframe(df_f, hide_index=True)

    # ── Extra fields ──────────────────────────────────────────────
    if 'extra_fields' in summary:
        with st.container(border=True):
            st.markdown("### 📎 Extra Fields")
            for fname, values in summary['extra_fields'].items():
                st.markdown(
                    f"**{fname}** — "
                    f"<span style='color:#8b949e'>{len(values)} unique values</span>",
                    unsafe_allow_html=True
                )
                st.dataframe(
                    pd.DataFrame(list(values.items())[:15],
                                 columns=['Value', 'Count']),
                    hide_index=True,
                )

    # ── Top repeated messages ─────────────────────────────────────
    if summary.get('top_messages'):
        with st.container(border=True):
            st.markdown("### 💬 Top Repeated Messages")
            for msg, cnt in list(summary['top_messages'].items())[:5]:
                st.markdown(
                    f"<span class='mono' style='font-size:12px;color:#8b949e'>"
                    f"[{cnt:,}×]</span> "
                    f"<span class='mono' style='font-size:12px'>{msg[:120]}</span>",
                    unsafe_allow_html=True
                )

# ================================================================
# Helpers: DataFrame builder
# ================================================================

def build_display_dataframe(matches: list, available: set) -> pd.DataFrame:
    rows = []
    for m in matches:
        row = {
            'Line':      m['actual_line_number'],
            'Timestamp': m['timestamp'],
        }
        if 'component'   in available: row['Component'] = m.get('component') or ''
        if 'level'       in available: row['Level']     = m.get('level')     or ''
        if 'thread_id'   in available: row['Thread']    = m.get('thread_id') or ''
        if 'file_path'   in available: row['File']      = m.get('file_path') or ''
        if 'line_number' in available: row['Src Line']  = m.get('line_number')
        row['Message'] = m.get('message', '')
        ef = m.get('extra_fields') or {}
        if ef:
            row['Extra'] = ' | '.join(f"{k}={v}" for k, v in ef.items())
        rows.append(row)
    return pd.DataFrame(rows)


def build_column_config(available: set) -> dict:
    cfg = {
        'Line':      st.column_config.NumberColumn('Line',    width='small'),
        'Timestamp': st.column_config.TextColumn('Timestamp', width='medium'),
        'Message':   st.column_config.TextColumn('Message',   width='large'),
    }
    if 'level'       in available:
        cfg['Level']     = st.column_config.TextColumn('Level',     width='small')
    if 'component'   in available:
        cfg['Component'] = st.column_config.TextColumn('Component', width='small')
    if 'thread_id'   in available:
        cfg['Thread']    = st.column_config.TextColumn('Thread',    width='small')
    if 'file_path'   in available:
        cfg['File']      = st.column_config.TextColumn('File',      width='medium')
    return cfg


# ================================================================
# Helper: LLM panel
# ================================================================

def _build_csv_context(matches: list, available: set) -> str:
    """Convert ALL filtered matches to a compact CSV string for LLM context."""
    import io
    rows = []
    for m in matches:
        row = {
            'line':      m['actual_line_number'],
            'timestamp': m['timestamp'],
        }
        if 'component'   in available: row['component'] = m.get('component') or ''
        if 'level'       in available: row['level']     = m.get('level')     or ''
        if 'thread_id'   in available: row['thread']    = m.get('thread_id') or ''
        if 'file_path'   in available: row['file']      = m.get('file_path') or ''
        row['message'] = m.get('message', '')
        ef = m.get('extra_fields') or {}
        for k, v in ef.items():
            row[f'extra_{k}'] = v
        rows.append(row)
    df = pd.DataFrame(rows)
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    return buf.getvalue()


def render_llm_panel(matches: list, match_summary: dict):
    meta      = st.session_state['log_metadata']
    available = set(meta.get('available_fields', []))

    with st.container(border=True):
        st.markdown(
            "<span class='mono' style='font-size:16px;font-weight:700;"
            "color:#f0a500'>// llm_chat</span>",
            unsafe_allow_html=True
        )

        total = len(matches)
        if total == 0:
            st.info("No filtered entries to analyse. Apply filters first.")
            return

        # ── Context info row ─────────────────────────────────────
        csv_data       = _build_csv_context(matches, available)
        csv_chars      = len(csv_data)
        est_tokens     = csv_chars // 4          # rough token estimate
        size_kb        = csv_chars / 1024

        warn_threshold = 100_000   # ~25k tokens — start warning
        token_color = '#f85149' if est_tokens > 100_000 else '#d29922' if est_tokens > 50_000 else '#3fb950'
        st.markdown(
            f"<span class='mono' style='font-size:12px;color:#8b949e'>"
            f"📊 <b style='color:#e6edf3'>{total:,}</b> entries &nbsp;·&nbsp; "
            f"CSV size: <b style='color:#e6edf3'>{size_kb:.1f} KB</b> &nbsp;·&nbsp; "
            f"Est. tokens: <b style='color:{token_color}'>{est_tokens:,}</b>"
            f"</span>",
            unsafe_allow_html=True
        )
        if est_tokens > warn_threshold:
            st.warning(
                f"⚠️ Large context ({est_tokens:,} tokens). "
                f"Make sure your Ollama model is configured with sufficient `num_ctx`. "
                f"Consider narrowing filters to reduce entries."
            )

        # ── Context preview ──────────────────────────────────────
        with st.expander("🔍 Preview data sent to LLM", expanded=False):
            st.caption(
                "This is the complete CSV that will be included in every message. "
                "The LLM can answer questions about any row."
            )
            preview_lines = csv_data.split('\n')
            preview_text  = '\n'.join(preview_lines[:51])   # header + 50 rows
            if len(preview_lines) > 52:
                preview_text += f"\n... ({len(preview_lines)-51:,} more rows)"
            st.code(preview_text, language='text')

        st.divider()

        # ── Chat history ─────────────────────────────────────────
        for turn in st.session_state['llm_history']:
            with st.chat_message(turn['role']):
                st.markdown(turn['content'])

        question = st.chat_input(
            f"Ask anything about these {total:,} log entries — all data is in context…"
        )
        if question:
            st.session_state['llm_history'].append({'role': 'user', 'content': question})
            with st.chat_message('user'):
                st.markdown(question)
            with st.chat_message('assistant'):
                with st.spinner("Thinking…"):
                    answer = call_ollama(
                        question, csv_data, match_summary, total=total
                    )
                st.markdown(answer)
                st.session_state['llm_history'].append(
                    {'role': 'assistant', 'content': answer}
                )

        if st.session_state['llm_history']:
            if st.button("🗑  Clear Chat"):
                st.session_state['llm_history'] = []
                st.rerun()


def call_ollama(
    question:      str,
    csv_data:      str,
    match_summary: dict,
    total:         int = 0,
) -> str:
    """
    Send the COMPLETE filtered log data as a CSV table in the LLM context.
    Every question has full access to every row — no sampling.
    num_ctx is set to 131072 to request a large context window from Ollama.
    """
    OLLAMA_MODEL = 'llama3.1'  
    try:
        import ollama
    except ImportError:
        return "❌ `ollama` package not installed. Run: `pip install ollama`"

    tr = match_summary.get('time_range', {})
    lr = match_summary.get('line_range', {})

    # ── Build stat header (compact, always included) ──────────────
    stat_lines = [
        "=== LOG DATA SUMMARY ===",
        f"Total entries in CSV below: {total:,}",
        f"Line range : {lr.get('first','?')} → {lr.get('last','?')}",
        f"Time range : {tr.get('first','?')} → {tr.get('last','?')}",
    ]
    if match_summary.get('levels'):
        level_str = ', '.join(f"{k}:{v}" for k, v in match_summary['levels'].items())
        stat_lines.append(f"Levels     : {level_str}")
    if match_summary.get('components'):
        top = list(match_summary['components'].items())[:8]
        stat_lines.append(f"Components : {top}")
    if match_summary.get('threads'):
        top_t = list(match_summary['threads'].items())[:6]
        stat_lines.append(f"Threads    : {top_t}")

    stat_header = '\n'.join(stat_lines)

    system_prompt = (
        "You are a log file analysis assistant. "
        "You have been given COMPLETE log data as a CSV table — every filtered row is present. "
        "The columns are: line (file line number), timestamp, component, level, thread, file, message, and any extra fields. "
        "Answer questions based only on this data. "
        "Reference specific line numbers and timestamps in your answers. "
        "When counting or aggregating, use the full dataset provided. "
        "Be concise and precise."
    )

    # ── Full context: stat header + complete CSV ──────────────────
    full_context = f"{stat_header}\n\n=== COMPLETE LOG DATA (CSV) ===\n{csv_data}"

    messages = [{'role': 'system', 'content': system_prompt}]

    # Include previous conversation turns (without repeating the CSV each time)
    history = st.session_state.get('llm_history', [])
    for turn in history[:-1]:
        messages.append({'role': turn['role'], 'content': turn['content']})

    # Current user message: inject full CSV on first turn only, reference it on subsequent turns
    is_first_turn = len(history) <= 1
    if is_first_turn:
        user_content = (
            f"Here is the complete filtered log data:\n\n{full_context}\n\n"
            f"Question: {question}"
        )
    else:
        # Subsequent turns: re-attach CSV so the model always has it
        # (stateless API — each call starts fresh)
        user_content = (
            f"[Log data: {total:,} entries, see CSV attached]\n\n"
            f"{full_context}\n\n"
            f"Question: {question}"
        )

    messages.append({'role': 'user', 'content': user_content})

    try:
        response = ollama.chat(
            model    = OLLAMA_MODEL,
            messages = messages,
            options  = {
                'temperature': 0.1,
                'num_ctx':     131072,   # request large context window
            }
        )
        return response['message']['content']
    except Exception as e:
        return (
            f"❌ Ollama error: {e}\n\n"
            f"Troubleshooting:\n"
            f"- Make sure Ollama is running: `ollama serve`\n"
            f"- Pull the model: `ollama pull {OLLAMA_MODEL}`\n"
            f"- If you get a context length error, reduce filtered entries with tighter filters."
        )

# ================================================================
# Utility
# ================================================================

def _reset_and_go_upload():
    tmp = st.session_state.get('tmp_path')
    if tmp and os.path.exists(tmp):
        os.unlink(tmp)
    for k in ['search_ops', 'log_metadata', 'filename', 'tmp_path', 'all_logs_json']:
        st.session_state[k] = None
    st.session_state['show_extra']           = False
    st.session_state['show_llm']             = False
    st.session_state['show_unparsed']        = False
    st.session_state['llm_history']          = []
    st.session_state['applied_filters']      = {}
    st.session_state['unparsed_lines']       = []
    st.session_state['parse_rate']           = 100.0
    st.session_state['detection_confidence'] = 0.0
    st.session_state['result_page']          = 0
    st.session_state['page']                 = 'upload'
    st.rerun()

# ================================================================
# Router
# ================================================================

page = st.session_state['page']

if page == 'upload':
    upload_page()
elif page == 'parsing':
    parsing_page()
elif page == 'dashboard':
    if st.session_state['search_ops'] is None:
        st.session_state['page'] = 'upload'
        st.rerun()
    else:
        dashboard_page()
elif page == 'summary':
    if st.session_state['search_ops'] is None:
        st.session_state['page'] = 'upload'
        st.rerun()
    else:
        summary_page()