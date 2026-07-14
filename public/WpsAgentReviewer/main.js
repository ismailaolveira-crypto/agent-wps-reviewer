var agentReviewerTaskPane = null;
var agentReviewerRibbon = null;

function OnAddinLoad(ribbonUI) {
  agentReviewerRibbon = ribbonUI;
  try {
    WpsDocumentConnector.start(getApplication());
  } catch (error) {
    // Keep the ribbon usable; the task pane can still open for diagnostics.
  }
  return true;
}

function OnGetEnabled(control) {
  return true;
}

function getApplication() {
  if (typeof wps !== 'undefined' && wps.WpsApplication) {
    return wps.WpsApplication();
  }
  if (typeof Application !== 'undefined') {
    return Application;
  }
  throw new Error('未找到 WPS Application 对象');
}

function ShowAgentReviewerPane() {
  var app = getApplication();
  // The bridge replaces this marker with the origin that served the WPS add-in.
  var url = '__WPS_REVIEWER_TASKPANE_URL__';

  if (!agentReviewerTaskPane) {
    agentReviewerTaskPane = createTaskPane(app, url, '审阅收件箱');
    if (!agentReviewerTaskPane) {
      throw new Error('WPS 未能创建任务窗格，请检查本地 bridge 地址是否被允许');
    }
    agentReviewerTaskPane.Caption = '审阅收件箱';
    agentReviewerTaskPane.Width = 420;
  }

  agentReviewerTaskPane.Visible = true;
  return true;
}

function createTaskPane(app, url, title) {
  var creators = [
    function () {
      return app && app.CreateTaskPane && app.CreateTaskPane(url, title);
    },
    function () {
      return app && app.CreateTaskpane && app.CreateTaskpane(url, title);
    },
    function () {
      return typeof wps !== 'undefined' && wps.CreateTaskPane && wps.CreateTaskPane(url, title);
    },
    function () {
      return typeof wps !== 'undefined' && wps.CreateTaskpane && wps.CreateTaskpane(url, title);
    }
  ];

  for (var i = 0; i < creators.length; i += 1) {
    try {
      var pane = creators[i]();
      if (pane) return pane;
    } catch (error) {
      // Try the next WPS task pane spelling/API shape.
    }
  }

  return null;
}

function OnAction(control) {
  if (control && control.Id === 'showAgentReviewerPane') {
    return ShowAgentReviewerPane();
  }
  return ShowAgentReviewerPane();
}
