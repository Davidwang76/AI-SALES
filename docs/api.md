# API

前缀 `/api/v1`，成功返回 `{data:...}`，失败返回 `{error:{code,message},meta:{trace_id}}`。金额字符串，UTC时间，UUID标识。除公共表单和登录，均需 HttpOnly会话cookie与授权 `X-Entity-Id`。POST来自浏览器时校验Origin和Host；会话SameSite=Strict。生产HTTPS开启Secure cookie。

## 入口与常用动作

- `POST /session {email,password}`，`GET /session`，`DELETE /session`。
- `GET /members`，`POST /members {name,email,password,role}`（owner），`POST /members/:id/deactivate`。
- `POST /account/password {old_password,new_password}`：至少12位，撤销全部会话。
- `GET/POST /activities`；候选展会 `POST /activities/:id/select`；成本 `/activities/:id/costs`。
- `POST /sources {name,body,kind,allowed_use}`；`POST /files` multipart单文件25MB，`GET /files/:id/download` 私有授权。
- `POST /leads {activity_id,event_id,company,email或phone,notes,source_id?,permission?,utm?}`；`POST /leads/:id/convert {account_id?,owner_id?}`。
- `GET /public/forms/:key`，`POST /public/forms/:key/submissions`：服务端绑定活动和主体；忽略客户端role/entity等越权字段；限流，蜜罐；重复事件内容不同409。
- `GET /accounts/:id` 聚合联系人/事实/来源/任务；`/facts`、`/assessments`、`/contacts`、`/transfer`、`/preferences`、`/relationships`、`/archive`。
- `POST /accounts/merge {from_id,to_id,reason}`；负责人确认合并，保留来源与软映射。双金融政策冲突须先复核。
- `POST /contacts/:id/suppress {reason}`，再导入保持抑制。`GET /contacts`。
- `POST /tasks`，`POST /tasks/:id/status {row_version,status,result?,check_again_at?}`。完成必须有result；等待必须有检查时间。
- `POST /opportunities`，`/:id/transitions`，`/:id/win {order_id,row_version}`：有已确认同客户订单才赢单。
- `POST /knowledge`，`/:id/approve`、`/:id/revoke`；`POST /contents`，`/:id/submit-review`、`/:id/approve`、`/:id/publications {url}`。
- `POST /market-tasks`，`/:id/revisions`；`/:id/budget/reserve {action_key,amount}`；`/:id/budget/:reservation/settle {actual,cancel?}`。
- `POST /discovery-runs {market_task_id,mode}`；`/:id/pause/resume/complete`；`/:id/candidates`；`POST /candidates/:id/convert`。
- `POST /channel-accounts`；`POST /conversations`；`GET/POST /conversations/:id/messages`（实际来信人工登记）；`/:id/drafts`；`POST/GET /sequence-enrollments`。
- `POST /rfqs {account_id,source_id,title,destination,lines:[{oe,description,quantity,unit,quality}]}`；`GET /rfqs/:id`；`POST /rfqs/:id/lines/:line`；`/:id/match`。
- `GET/POST /products`、`/suppliers`、`/purchase-rfqs`；`POST /purchase-rfqs/:id/responses`；`GET /purchase-rfqs/:id/comparison`；`POST /supplier-responses/:id/select {reason}`。
- `POST /quotes/calculate {cost,quantity,pack,fees,margin,fx,direction}`：纯确定性计算，不保存交易。direction为cost_to_quote或quote_to_cost。
- `POST /quotes`、`/:id/revisions`、`/:id/approve`、`GET /quotes/:id`、`/:id/export`、`POST /quotes/:id/feedback`、`/:id/register-dispatch`。审批绑定确切快照；导出不改发送状态；人工发送登记需真实证据，不执行外发。
- `POST /orders`：有效批准报价及真实确认依据；`GET /orders/:id`；`/:id/shipments`；`/:id/documents`；`/:id/release`、`/:id/recognize-receivable`。
- `POST /receipts`、`/:id/verify`、`/:id/allocate`，`POST /allocations/:id/reverse {reason}`；不同币种不能直接相抵。
- `POST /accounts/:id/credit-policy`、`/:id/payment-policy`；`GET /accounts/:id/credit`、`/:id/operating-view`；`POST /financial-settings`。
- `POST /samples`、`/:id/status`；`POST /aftersales`、`/:id/resolve`；`POST /trade-documents/:id/approve`、`GET /trade-documents/:id/export`。
- `POST /automation-rules`；`GET /:id/preview`；`POST /:id/enable/pause/execute`（仅内部任务，禁止外发）。
- `POST /eval-datasets`、`/eval-runs`、`/release-gates`；`POST /feedback`；`POST /work-logs`。
- `GET /integrations`、`/jobs`；`POST /ai-jobs {source_id,kind}`；无凭据落为needs_manual。`POST /actions/send`始终503 OUTBOUND_DISABLED。
- `GET /reports/dashboard?demo=false`、`/reports/finance`、`/reports/runtime`、`/audit-events`；`GET /exports/accounts` 防CSV公式注入。

列表默认100条，部分交易列表上限200；通用列表支持limit/offset/q，活动、客户、线索等通用列表与产品/交易列表的q在服务端筛选；其余专用列表仍为限量读取。完整字段以服务端Zod schema为准，入口位于 `apps/api/server.ts`、`trade.ts`、`operations.ts`。后续升级应生成完整OpenAPI schema，当前此文档为等价人工接口说明。

## 错误语义

400字段格式；401未登录/停用；403角色/主体无权限；404对象不存在或不可见；409版本或幂等冲突；422证据、审批、许可、预算、数量、币种等业务阻断；429限流；503依赖未连接/外发关闭。客户端不可把非2xx显示成成功。
