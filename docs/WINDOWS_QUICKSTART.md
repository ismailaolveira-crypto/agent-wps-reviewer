# Windows 同事版

只需要关注三个文件：

1. `START_HERE.md`：本包入口；
2. `setup.cmd`：唯一安装入口；
3. `WORKBUDDY_SETUP.md`：交给 WorkBuddy 执行的完整说明。

前置条件：Windows 10/11 x64、WPS Office 和 Node.js 20+。仓库与 Beta Release 均可公开读取，不需要 GitHub 登录。

安装：

```bat
setup.cmd
npm run doctor
```

首次加载必须通过 WPS 官方 publish/trust 流程。安装器不会修改 `authaddin.json`，也不要求管理员权限。
