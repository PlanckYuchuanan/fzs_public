# 设计规范 - 现代简约风格

## 1. 设计理念
- **现代简约**：干净的布局，充足的留白
- **柔和色彩**：以白色为基调，辅以淡紫色和粉色作为强调色
- **层次分明**：通过阴影和卡片营造立体感
- **清晰易读**：无衬线字体，适当的字重和间距

## 2. 色彩系统

### 主色
- **Primary**：`#8B5CF6`（紫色）
- **Primary Light**：`#A78BFA`
- **Primary Dark**：`#7C3AED`

### 辅助色
- **Secondary**：`#EC4899`（粉色）
- **Secondary Light**：`#F472B6`
- **Secondary Dark**：`#DB2777`

### 中性色
- **Background**：`#FFFFFF`
- **Background Light**：`#F9FAFB`
- **Surface**：`#FFFFFF`
- **Surface Variant**：`#F3F4F6`
- **Text Primary**：`#111827`
- **Text Secondary**：`#4B5563`
- **Text Tertiary**：`#9CA3AF`
- **Border**：`#E5E7EB`

### 状态色
- **Success**：`#10B981`
- **Warning**：`#F59E0B`
- **Error**：`#EF4444`
- **Info**：`#3B82F6`

## 3. 字体系统

### 主字体
- **Family**：Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
- **Weight**：
  - Regular: 400
  - Medium: 500
  - Semibold: 600
  - Bold: 700

### 字号
- **Headline 1**：24px / 32px
- **Headline 2**：20px / 28px
- **Headline 3**：18px / 24px
- **Body Large**：16px / 24px
- **Body Medium**：14px / 20px
- **Body Small**：12px / 16px
- **Caption**：11px / 14px

## 4. 间距系统
- **XXS**：4px
- **XS**：8px
- **S**：12px
- **M**：16px
- **L**：24px
- **XL**：32px
- **XXL**：48px

## 5. 圆角系统
- **None**：0px
- **Small**：4px
- **Medium**：8px
- **Large**：12px
- **X-Large**：16px
- **Full**：9999px

## 6. 阴影系统
- **None**：0 0 0 0 rgba(0, 0, 0, 0)
- **Small**：0 1px 2px 0 rgba(0, 0, 0, 0.05)
- **Medium**：0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)
- **Large**：0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)

## 7. 组件规范

### 7.1 卡片
- **背景**：`#FFFFFF`
- **边框**：`1px solid #E5E7EB`
- **圆角**：8px
- **阴影**：Small
- **内边距**：16px

### 7.2 按钮
- **Primary**：
  - 背景：`#8B5CF6`
  - 文字：`#FFFFFF`
  - 圆角：8px
  - 阴影：Small
  - 悬停：`#7C3AED`

- **Secondary**：
  - 背景：`#F3F4F6`
  - 文字：`#4B5563`
  - 圆角：8px
  - 悬停：`#E5E7EB`

### 7.3 导航
- **背景**：`#FFFFFF`
- **宽度**：240px
- **激活状态**：
  - 背景：`#F3F4F6`
  - 文字：`#8B5CF6`

### 7.4 日程条目
- **背景**：`#FFFFFF`
- **边框**：`1px solid #E5E7EB`
- **圆角**：8px
- **阴影**：Small
- **内边距**：12px

## 8. 布局规范
- **总宽度**：100%
- **左侧导航**：240px
- **主内容区**：flex: 1
- **右侧信息栏**：320px
- **间距**：16px

## 9. 响应式设计
- **Desktop**：≥ 1024px
- **Tablet**：768px - 1023px
- **Mobile**：< 768px

## 10. 动效规范
- **过渡时间**：150ms
- **缓动函数**：ease-in-out
- **hover 效果**：轻微上浮（2px）和阴影增强
- **点击效果**：轻微下沉（1px）

## 11. 图标规范
- **风格**：线性图标
- **颜色**：`#4B5563`
- **尺寸**：16px, 20px, 24px
- **间距**：8px

## 12. 应用场景
- 日历/日程应用
- 项目管理系统
- 个人效率工具
- 企业内部系统
