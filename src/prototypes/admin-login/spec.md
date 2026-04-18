这是项目FZS的文档；
端：管理端；
共享：同一 MySQL+同一后端 server/index.mjs；路由前缀：/api vs /api/admin

# 管理员登录

## 页面目标

提供一个独立的管理员登录页（科技风风格），不支持注册，仅支持手机号 + 密码登录。

## 页面结构

- 背景：与管理员登录后管理后台一致的偏暖色科技感背景（渐变 + 网格），保证风格统一
- 登录卡片：
  - 标题：管理员登录
  - 表单：手机号、密码、登录按钮
  - 底部：弱化“返回用户登录”
- 登录后：
  - 全屏左右布局（不再使用登录卡片容器）
  - 左侧菜单（管理后台偏暖色科技风，与产品端有细微色彩差异）
    - 客户管理（待定义）
    - 产品和服务管理（待定义）
      - 子菜单 TAB：产品服务 / 产品服务类型（内容待定义）
    - 用户管理
    - 管理员
    - 系统设置
  - 右侧主内容
    - 顶部：当前管理员信息、退出、返回用户登录
    - 用户管理：展示 `users` 列表，支持启用/停用（停用后不可登录）
    - 管理员：展示 `admin_user` 列表，支持启用/停用、权限范围设置、超管标记切换
    - 系统设置：配置“用户端是否开放注册”

## 交互说明

- 登录接口：`POST /api/admin/auth/login`
- 登录态读取：`GET /api/admin/auth/me`
- 刷新：`POST /api/admin/auth/refresh`
- 退出：`POST /api/admin/auth/logout`
- 管理接口：
  - `GET /api/admin/users`
  - `POST /api/admin/users/status`
  - `GET /api/admin/admin-users`
  - `POST /api/admin/admin-users/create`（仅超管，新增管理员：phone/password）
  - `POST /api/admin/admin-users/status`
  - `POST /api/admin/admin-users/permission`
  - `GET /api/admin/platform-settings`（读取平台配置）
  - `POST /api/admin/platform-settings`（仅超管，更新平台配置）
  - 用户分页：`GET /api/admin/users?page=1&pageSize=20` → `users/page/pageSize/total`
  - 产品服务类型管理：
    - `GET /api/admin/product-service-types`
    - `POST /api/admin/product-service-types/create`
    - `POST /api/admin/product-service-types/update`
    - `POST /api/admin/product-service-types/delete`（删除前校验：该类型下无关联产品服务）
  - 产品服务管理：
    - `GET /api/admin/product-services`
    - `POST /api/admin/product-services/create`（名称不可重复，WBS编码不可重复）
    - `POST /api/admin/product-services/update`（名称不可重复，WBS编码不可重复）
    - `POST /api/admin/product-services/delete`
    - `POST /api/admin/product-services/reorder`（body：`{ serviceId, direction: 'up' | 'down' }`）
- 登录错误提示映射：
  - `INVALID_CREDENTIALS`：手机号或密码错误
  - `DB_UNAVAILABLE`：服务暂不可用，请稍后重试
  - `PHONE_REQUIRED`：手机号不能为空
  - `PHONE_INVALID`：手机号格式不正确（中国大陆 11 位）
  - `PASSWORD_REQUIRED`：密码不能为空

## 第三方接口（Tripartite）

### 对接信息

- 测试地址：`http://tr.yeyeku.com/gs_tripartite_web/openapi/service/<servicePath>`
- 请求类型：`POST`
- Content-Type：`application/json;charset=utf-8`
- 公共参数（body）：
  - `clientId`：客户端 id（string）
  - `requestId`：请求ID（string，不可重复，推荐 uuid）
  - `scene`：场景（string，业务方自定义）
  - `timestamp`：时间戳（long）
  - `signType`：默认 `RSA2`
  - `sign`：签名（string，Base64）
  - `data`：json 字符串（string，具体字段见各 service 的文档）

### 签名规则（RSA2）

- 将参数按参数名称升序排序，拼成 `key=value&key=value` 得到 `sortStr`
- 使用开发者中心的 RSA 私钥对 `sortStr` 做 `SHA256WithRSA` 签名，结果 Base64 作为 `sign`

### 本项目调用方式（服务端代理）

- 管理端调用接口：`POST /api/admin/tripartite/call`
- body：
  - `servicePath`：第三方 service 路径（如 `xxx/yyy`）
  - `scene`：场景
  - `data`：对象或字符串；对象会在服务端 `JSON.stringify` 后参与签名并透传
  - `requestId` / `timestamp` / `clientId` / `signType`：可选；不传则由服务端生成或读取配置
- 返回：
  - 成功：`{ success: true, upstream: { statusCode, data } }`
  - 失败：`{ success: false, code, message, upstream? }`

### 配置项（环境变量）

- `TRIPARTITE_BASE_URL`：第三方 base url（默认 `http://tr.yeyeku.com/gs_tripartite_web/openapi/service`）
- `TRIPARTITE_CLIENT_ID`：第三方 clientId
- `TRIPARTITE_SIGN_TYPE`：默认 `RSA2`
- `TRIPARTITE_RSA_PRIVATE_KEY`：开发者 RSA 私钥（PKCS8，支持 PEM 或 base64）
- `TRIPARTITE_RSA_PRIVATE_KEY_FILE`：开发者 RSA 私钥文件路径（优先级低于 `TRIPARTITE_RSA_PRIVATE_KEY`）
- `TRIPARTITE_PLATFORM_PUBLIC_KEY`：平台公钥（base64，预留用于验签）
- `TRIPARTITE_PLATFORM_PUBLIC_KEY_FILE`：平台公钥文件路径（优先级低于 `TRIPARTITE_PLATFORM_PUBLIC_KEY`）

## 数据库

- 管理员表：`admin_user`
  - `id`：管理员ID
  - `phone`：手机号（唯一）
  - `created_at`：创建时间
  - `last_login_at`：最后登录时间（可空）
  - `is_superadmin`：是否超管
  - `is_enabled`：是否启用（停用后不可登录）
  - `permission_scope`：权限范围（字符串，待后续扩展）
  - 额外字段（内部使用）：`password_salt`、`password_hash`

- 用户表：`users`
  - 新增：`is_enabled`（是否启用，停用后不可登录）

- 平台配置表：`platform_settings`
  - `setting_key`：配置键（主键）
  - `setting_value`：配置值（string，布尔用 `true/false`）
  - `updated_at`：更新时间
  - `updated_by_admin_id`：更新人管理员ID（可空）

- 产品服务类型表：`product_service_types`
  - `id`：类型ID
  - `name`：名称
  - `wbs_code`：WBS代码（可重复）

- 产品服务表：`product_services`
  - `id`：产品服务ID
  - `type_id`：产品服务类型ID（可空，用于与 `product_service_types` 关联）
  - `name`：产品服务名称（不可重复）
  - `wbs_code`：WBS编码（不可重复）
  - `description`：描述
  - `reference_weeks`：参考时间（周）
  - `owner_text`：责任方（文本描述）
  - `is_enabled`：启用/停用状态
  - `sort_order`：排序值（越小越靠前）

## 运维脚本

- 初始化/更新管理员账号：
  - 命令：`npm run seed:admin -- --phone=15823497335 --password=123456 --superadmin=true`
  - 说明：若手机号已存在则更新密码和超管标记，不重复插入
