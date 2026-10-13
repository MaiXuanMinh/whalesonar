# WhaleSonar

Soi token on-chain: nhập mã token (VD: `PEPE`) hoặc dán địa chỉ contract → báo cáo trực quan gồm giá, thanh khoản, top holder, % mua/bán của cá voi, lượng mua/bán theo 5p / 1h / 6h / 24h, dòng tiền, bảo mật contract và điểm rủi ro.

Toàn bộ phân tích chạy ngay trong trình duyệt (`public/core.js`) — không cần server, không cần API key.

## Dùng trên điện thoại (Android)

Mở link GitHub Pages của app bằng Chrome → menu ⋮ → **Thêm vào màn hình chính** / **Cài đặt ứng dụng**.

## Dùng trên Windows

```
powershell -ExecutionPolicy Bypass -File build.ps1
```

Tạo icon `WhaleSonar` ngoài Desktop (server chạy ngầm, mở cửa sổ app bằng Edge, tự tắt ~3 phút sau khi đóng). Cần Node.js 18+.
Hoặc chạy tay: `node server.js` rồi mở http://localhost:3939.

## Cập nhật

Đẩy code lên nhánh `main` → GitHub Actions tự đăng thư mục `public/` lên GitHub Pages (1–2 phút).

## Nguồn dữ liệu (miễn phí)

| Dữ liệu | Nguồn |
|---|---|
| Giá, thanh khoản, số lệnh mua/bán, volume, tìm theo mã | DexScreener |
| Top 10 holder, honeypot, thuế, quyền owner/mint, LP lock | GoPlus Security |
| Lịch sử giao dịch (cá voi, ví), nến giá | GeckoTerminal |

## Giới hạn

- GeckoTerminal chỉ trả 300 lệnh gần nhất mỗi lần gọi → với token giao dịch nhiều, giá trị mua/bán USD ở khung dài được **ước tính** (tỷ lệ mua/bán của mẫu × volume thật).
- GeckoTerminal giới hạn ~30 request/phút; phân tích liên tục nhiều token có thể bị thiếu dữ liệu (app sẽ báo).
- Ngưỡng cá voi = top 5% lệnh lớn nhất gần đây (tối thiểu $500).
- Báo cáo chỉ mang tính tham khảo, không phải lời khuyên đầu tư.
