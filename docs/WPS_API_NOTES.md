# WPS API Notes

The add-in uses a compatibility layer for WPS APIs because the public docs expose more than one spelling or calling style for a few key operations.

Checked sources:

- WPS Open Platform `Application.CreateTaskPane`: https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/jsapi/addin-api/Application/member/CreateTaskpane
- WPS legacy `wps.CreateTaskpane`: https://qn.cache.wpscdn.cn/encs/doc/office_v13/topics/WPS%20%E5%9F%BA%E7%A1%80%E6%8E%A5%E5%8F%A3/%E5%8A%A0%E8%BD%BD%E9%A1%B9%20API%20%E5%8F%82%E8%80%83/Office%20%E5%85%A8%E5%B1%80%E5%AF%B9%E8%B1%A1/%E6%96%B9%E6%B3%95/CreateTaskpane%20%E6%96%B9%E6%B3%95.htm
- WPS WebOffice advanced API overview: https://developer.kdocs.cn/client/advanced/summary/guide.html
- WPS WebOffice Word comments API: https://solution.wps.cn/docs/client/api/Word/Comments.html

Implementation choices:

- Production `publish.xml` and `jsplugins.xml` entries intentionally omit `debug=""` and `enable="enable_dev"`. Those are development/debug attributes; keeping them in a user install exposes WPS's "打开JS调试器" UI. Development troubleshooting must be explicit and must not be used as production acceptance evidence.

- Task pane creation tries `Application.CreateTaskPane`, `Application.CreateTaskpane`, `wps.CreateTaskPane`, then `wps.CreateTaskpane`.
- Comment creation tries the object shape first: `Comments.Add({ Range: { Start, End }, Text })`.
- It then falls back to `Comments.Add({ Range, Text })` and `Comments.Add(range, text)`.
- Multi-document targeting enumerates `Application.Documents` with common collection spellings (`Count`/`Length`, `Item`/`item`) and always includes `ActiveDocument` as a fallback.
- Target activation tries document-level `Activate`/`activate` and application-level `ActivateDocument`/`Activate` variants. The bridge returns the target handle and title; the task pane verifies the active document identity before locating or writing.
- Accepted-comment reconciliation reads the current document's `Comments` collection without activating another document. It accepts common collection spellings (`Count`/`Length`, `Item`/`item`) and comment range spellings (`Scope`, `Anchor`, `Reference`, `TargetRange`, `Range`). If the collection cannot be read, the task pane keeps the existing status instead of falsely reopening the suggestion.
- A successful comment write persists a local fingerprint containing the suggestion id, anchor range, anchor text, and a short comment-text summary. If status PATCH fails, the operation log and fingerprint allow retrying status without calling `Comments.Add` again. If native WPS undo removes the comment, the next reconciliation reopens the suggestion as `pending`.

These fallbacks do not replace the required foreground WPS validation. They only reduce the risk that one documented API spelling fails on the installed WPS build.
