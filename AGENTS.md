# Hướng dẫn cho Codex

## Mục tiêu

Hoàn thiện `Seating Repair` thành một submission WebMCP nhỏ, ổn định và dễ demo. Đây là web app một trang cho phép con người sửa/khóa vị trí khách, sau đó agent đọc đúng live state qua WebMCP và sửa phần còn lại mà không ghi đè quyết định của con người.

## Nguyên tắc bắt buộc

- Trao đổi và báo cáo công việc bằng tiếng Việt.
- UI, README, tool name, tool description và nội dung submission dùng tiếng Anh.
- Giữ Vite + Vanilla TypeScript; không đổi sang React hoặc Next.js.
- Không backend, database, login, embedded chatbot hay external AI API.
- Không mở rộng sang nhiều event, import CSV, email, sharing, realtime collaboration hoặc analytics.
- Không hardcode chuỗi thao tác demo vào solver. Mọi kết quả phải sinh từ state và constraints hiện tại.
- WebMCP phải dùng imperative API tại top-level page.
- Mọi write tool phải dùng `expectedRevision` và fail closed khi state đã đổi.
- Agent không được di chuyển guest đã khóa khi `respectLocks=true`.
- Solver không được apply kết quả một phần hoặc vi phạm constraints.

## Kiến trúc hiện tại

- `src/types.ts`: domain contracts.
- `src/data/demo.ts`: fixture và demo prompts.
- `src/domain/validation.ts`: deterministic validator.
- `src/domain/solver.ts`: deterministic backtracking solver.
- `src/state/store.ts`: source of truth, revision guard, persistence, activity log.
- `src/webmcp/registerTools.ts`: bốn WebMCP tools và runtime validation.
- `src/ui/render.ts`: one-page UI, human move/lock controls.

## Bốn WebMCP tools cố định

1. `get_seating_state`
2. `add_seating_constraints`
3. `repair_seating_plan`
4. `validate_seating_plan`

Không thêm tool mới nếu chưa chứng minh tool đó làm demo rõ hơn.

## Trạng thái triển khai

- Dependency đã được khóa trong `package-lock.json`.
- Typecheck, 23 automated tests và production build chạy chung qua `npm run check`.
- Solver đã có test cho deterministic minimum-move repair, locks, cancellation,
  invalid constraints và unsatisfiable state.
- Store đã có test cho revision guard, duplicate constraints, persistence lỗi và
  no-mutation khi repair thất bại.
- WebMCP đã có test đăng ký đúng bốn tools và chạy trọn collaboration flow.
- README và `SUBMISSION.md` chứa hướng dẫn demo, Devpost copy và video script.

Khi bảo trì, không thay đổi fixture hoặc prompt demo mà không chạy lại toàn bộ flow
agent → human move/lock → agent repair. Không tăng scope chỉ để thêm CRUD hoặc UI phụ.

## Definition of done

- `npm run check` pass.
- App chạy bằng `npm run dev` và build static thành công.
- Fixture ban đầu có ba conflicts và repair về zero.
- Human move Grandma Rose sang Family Table rồi lock; agent vẫn repair được quanh vị trí đó.
- Stale write trả `STATE_CHANGED`, không mutate state.
- Cả bốn tools xuất hiện và gọi được trong ChatGPT browser.
- Demo reset được về cùng một trạng thái xác định.
