/**
 * 关于页文案。主页面只留一句话定位，详细内容分流：
 * 使用说明书 → manual-text.ts；更新日志 → changelog-text.ts。
 * 写法遵循 docs/ui-copy.md 第二节：克制、短句、列表项不加句末标点。
 */
export const ABOUT_INTRO = `自己填 API Key，请求直连服务商，不经过任何中转。所有数据只存本机，没有账号体系。`

/**
 * 致谢与推荐：两个借鉴来源分别标注（协议不同，不能合并成一句「均 MIT」）。
 * DeepSeek Harness 为 MIT，本项目协议随它；Chatbox 社区版为 GPLv3，只取思路与参数。
 * 链接走 platform.openLink 打开。
 */
export const ABOUT_CREDITS = `联网搜索等逻辑借鉴 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT），本项目协议与其保持一致。
附件、搜索可用性、思考档位的做法参考 [Chatbox 社区版](https://github.com/chatboxai/chatbox)（GPLv3），仅取思路与参数。
想要更稳定的手机端本地聊天体验？推荐 [Chatbox](https://chatboxai.app)（社区版 / 官方版）。`
