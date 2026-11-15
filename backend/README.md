# SPHEREx Phase 2：本機 FastAPI 後端

## 本機啟動（Windows PowerShell）

第一次 Clone 請先參考[根目錄 README 的 Requirements 與 Quick Start](../README.md#quick-start)。以下所有指令都在 Clone 後的**專案根目錄**執行（同時含有 `backend/`、`research/`、`frontend/` 的資料夾），不要先切換到 `backend/`；不要求特定磁碟或絕對路徑。

建立 Python 3.11 虛擬環境並安裝執行所需套件（已完成者可跳過）：

```powershell
py -3.11 -m venv research/.venv
.\research\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
```

`backend/requirements.txt` 透過 `-r ../research/requirements.txt` 引用研究階段依賴；pip 依 requirements 檔案位置解析該路徑，不需額外安裝一次。直接使用虛擬環境的 `python.exe`，不需執行 `Activate.ps1`。

啟動 FastAPI（port 8000），並保持此 Terminal 執行中：

```powershell
.\research\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

開啟 http://127.0.0.1:8000/docs 使用互動式 API。`GET /health` 只檢查後端可回應，不呼叫 NASA。

另開一個位於專案根目錄的 Terminal，執行 `node frontend/tools/serve.mjs`（Node.js 18+，不需 `npm install`），再開啟 http://127.0.0.1:5500/planet-x/。頁面選「本機 localhost」，API 基底網址填 `http://127.0.0.1:8000`。前後端分別在兩個 Terminal 運作；按 `Ctrl+C` 停止各自的伺服器。

## PowerShell 測試

保持 FastAPI 執行，另開位於專案根目錄的 PowerShell 執行以下指令。這會實際連線 NASA，PNG 下載至專案根目錄。

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
$body = @{ ra = 127.69444; dec = -39.17760; radius_deg = 0.01 } | ConvertTo-Json
$preview = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/preview -ContentType 'application/json' -Body $body -TimeoutSec 900
$preview | ConvertTo-Json -Depth 20
Invoke-WebRequest -Uri $preview.image_url -OutFile preview.png
Invoke-Item preview.png
Invoke-WebRequest -Uri $preview.inverted_image_url -OutFile preview-inverse.png
Invoke-Item preview-inverse.png
```

輸入為十進位度數，`0 <= ra < 360`、`-90 <= dec <= 90`、`0 < radius_deg <= 5/60`；必須為 JSON 數值，拒絕字串、布林值、NaN、Infinity 與多餘欄位。

**搜尋半徑只控制 SIA2 搜尋。** Preview 新增 `cutout_profile` enum：`small`＝3 arcmin（省略時的預設）、`medium`＝6.5 arcmin；拒絕其他值、任意尺寸及額外欄位。角度由後端固定白名單提供，URL 與 renderer 共用同值。Multi-epoch 維持 3 arcmin 與 29×29 輸出。

Cutout 不保證涵蓋整個搜尋圓。候選沿用既有 WCS 目標中心與有效像素檢查；Medium 目標約 64×64，實際 shape 依 FITS/WCS 及裁切而定。metadata 新增 `cutout_profile`、`requested_cutout_arcmin`、`actual_shape_yx` 及 `wcs_field`；後者以完整 IMAGE WCS（含 SIP 等可用 distortion）在兩條像素格邊界中心線各取 17 點，回傳球面路徑長度（arcmin）、pixel／ICRS samples 和四角。這不是 RA 軸差值、天球 bounding box 或完整 coverage 保證；無法驗證時明示 `available=false`。

Medium 僅完成本機離線整合，未部署；資源、瀏覽器驗收及仍未驗證項目見 [Preview Medium 報告](../docs/preview-medium-integration.md)。下載／像素／JSON／快取／Deadline 限制均未提高。

成功回傳 `key`、`image_url`、`inverted_image_url`、`expires_in_seconds` 與 `metadata`。metadata 保留原始 SIA 列、MJD 時間、UTC 時間、detector、HDU headers、處理版本、Cutout URL、亮度 stretch、影像維度、FITS 大小、候選嘗試次數、耗時及查詢截斷資訊。

影像 URL 為目前 API 的絕對 URL，`GET /api/images/{key}.png` 回傳 `image/png`。記憶體快取保留至多 32 組／16 MiB，10 分鐘到期，也可能提早因容量限制被淘汰；後端重啟後失效。不存在或到期請重新 POST。FITS 和中間產物只在每次請求專屬暫存目錄使用，結束後清除。一次只執行一項轉圖工作，所以本階段請使用單一 worker。

## 錯誤

API 錯誤格式為 `{"error":{"code":"...","message":"..."}}`，輸入驗證另有 `details`。

| HTTP | code | 含義 |
|---|---|---|
| 422 | invalid_input | 輸入或 JSON 無效 |
| 404 | no_images | DR1 與 QR3 都正常回傳空表 |
| 404 | image_not_found | 圖片 key 無效、到期或遭淘汰 |
| 502 | upstream_error / cutout_failed | NASA／VOTable 失敗，或候選／請求預算內無有效 Cutout |
| 504 | upstream_timeout | SIA2 或全部候選下載逾時 |
| 503 | busy | 已有工作執行，依 Retry-After 重試 |
| 500 | internal_error | 未預期後端錯誤，詳細原因記錄於伺服器日誌 |

DR1 只有空表才查 QR3，查詢上限仍為 50 筆；先按 `s_region` 的球面覆蓋多邊形排序：中心在內且離邊界較遠優先，其次缺少覆蓋資料，已知中心在外最後。缺少或不支援的 footprint 不會直接判定無覆蓋。這是預篩與排序，不能代替最終 FITS 的 WCS／有效像素檢查。

不再固定只嘗試前五張：從這份結果中最多嘗試 10 個不同 Cutout URL，確認 WCS 越界後不再下載同一 URL。沒有為了更多候選反覆查詢 SIA，也不會因 `OVERFLOW` 無限擴大查詢。

`backend/app/nasa_requests.py` 集中設定請求預算：單次 preview 的 SIA 與 Cutout 合計最多 16 次下載嘗試，每個 URL 最多三次（初次＋兩次重試），僅對 HTTP 503 重試。退避為 1、2 秒；`Retry-After` 支援秒數與 HTTP 日期，等待較長者，切換候選也不能跳過同一次 preview 的 cooldown。若等待超過 15 秒或剩餘總預算，就停止本次 preview，不能截短 Retry-After 後提早重試。非 503 不自動重試。

共用 120 秒協作式 deadline，每次連線／socket timeout 最多 20 秒，下載以單次底層讀取並逐塊檢查期限。這不是能強制中斷 DNS、HTTP 標頭讀取或 OS 阻塞的硬性牆鐘上限；執行中的 I/O 可能超出剩餘期限，逾時後不再開始新請求。Cutout 上限 32 MiB，VOTable 上限 8 MiB，不自動下載完整影像。成功 metadata 增加 `candidate_source_index`（原 SIA 零基序號）、`footprint_margin_arcsec` 和 `nasa_request_count`，既有 API 欄位及錯誤 code 保留。

若 Cutout 越界，日誌還會提供 `parent_window`：在 alternate A 座標及 SIA 原曝光尺寸齊全時，列出 Cutout 在原曝光的起點、目標原像素座標與是否接觸原曝光邊界。資料不足則標明不可判定，不推測 NASA 格式有誤。

## Phase 4.3：多時期 metadata API

`POST /api/epochs/search` 只向 IRSA SIA2 查詢 metadata，不下載 FITS、不產生影格或動畫。原有 `/api/preview` 請求及回應格式保持相容。

請求例子（JSON）：

```json
{
  "ra": 127.69444,
  "dec": -39.17760,
  "radius_deg": 0.01,
  "collections": ["spherex_dr1", "spherex_qr3"],
  "detectors": [1],
  "time_range_mjd": [60790.0, 61190.0],
  "limit": 100
}
```

座標邊界與嚴格型別沿用 preview；額外欄位會被拒絕。`collections` 預設兩個 Wide collections，非空且不得重複，不接受 deep／cube／任意 collection。`detectors` 可省略或 null（全部），否則為不重複的整數 1～6 非空陣列。`time_range_mjd` 可省略或 null，否則為兩個有限 JSON 數值 `[start,end]`、start ≤ end，UTC MJD 日，採曝光區間相交（含邊界）；有時間篩選時排除時間缺失／無效產品。`limit` 為每頁 **曝光** 數量，預設 100、範圍 1～200；同曝光所有產品一併回傳，不拆開 detector。

每個所選 collection 都會查詢，不採 preview 的 DR1 非空即停止策略。每來源固定 `MAXREC=1000`、XML 最多 8 MiB，時間條件也傳至 SIA `TIME`；detector 於取得有界 snapshot 後篩選。因此 detector 篩選不保證消除上游截斷。沒有 OFFSET、無界分段補查或更多資料自動下載。

成功 HTTP 200 回應包含：

- `schema_version`、`search_id`、正規化 `query`、`queried_at`、`expires_at`、`time_scale=utc`。
- `collections`：逐來源 `name`、`status=ok/partial/error`、`returned_rows`（失敗為 null）、`truncated`、`request_count`、`query_status`（解析成功時）、`error`。單一來源失敗仍回可用資料，`complete=false`；`OVERFLOW` 也一定揭露為 partial。全部失敗回 502 `upstream_error`，全部逾時回 504 `upstream_timeout`。正常空結果為 200、空陣列。
- `counts`：整份篩選後 snapshot 的 `products`、`exposures`、`metadata_center_covered_exposures`，不隨頁面改變。
- `epochs`：依 `obs_id` 分組，保留產品原始時間，曝光時間為組內最早開始／最晚結束；UTC 由 Astropy 換算，`time_source=sia`。缺少 obs_id 的產品各成獨立 unknown 曝光，不按相近時間合併。曝光依 `(start_mjd,epoch_id)` 排序，缺時間排最後。
- `products`：同頁曝光的產品，依 `(t_min,obs_id,detector,product_id)` 排序。包含原始 MJD、detector、來源、publisher DID、產品類型、`em_min/em_max`（公尺）、來源 URL、處理版本／日期、footprint 預篩與 warnings。`product_id` 是來源 URL 的 SHA-256；同 URL 合併 `source_collections`。不同 URL／處理版本保守保留並提示，不自動判定鏡像或 supersession，`superseded_product_ids=[]`。
- `pagination`：`unit=epochs`、`limit`、`next_cursor`；最後一頁為 null。續頁重送相同查詢條件，加上 cursor，limit 可調整；不再查 NASA。cursor 綁定 snapshot 與篩選條件且有簽章，無效／不匹配回 422 `invalid_cursor`；snapshot 到期／淘汰回 410 `search_expired`。重啟後舊 cursor 簽章失效，回 422，需重新搜尋。

FITS 才能驗證的欄位保留未知：`date_obs=null`、pipeline 軟體版本 null、目標波長／bandwidth null、`target_wavelength_status=not_evaluated`、`wcs_verified=false`、`valid_fraction=null`、`frame_status=not_requested`、`image_url=null`。`coverage.center` 只表示 metadata polygon 的中心預篩（含目標／目標在外／未知），不保證整個視窗有效。v27 僅標記 `release_compatible_header_unverified`；未知版本為 `unknown_header_unverified`。同 detector 或 detector 波長範圍不能代表同目標位置波段。

snapshot 快取為單 worker 記憶體、最多 32 份／8 MiB JSON 編碼資料量（不是程序 RSS 上限），FIFO 淘汰；完整非空結果 TTL 1 小時，完整空結果 5 分鐘，部分結果 60 秒。查詢鍵使用精確座標、半徑、正規化 filters，不包含 limit／cursor；同查詢與續頁命中零上游請求。超過單份快取容量回 503 `metadata_capacity`，請縮小範圍。到期時間不因讀取延長。

新搜尋與 preview 共用既有工作鎖，忙碌回 503 `busy` 與 `Retry-After: 5`；快取讀取可繼續。metadata 沿用 120 秒總期限、20 秒 socket timeout、最多 16 次／每 URL 3 次及最多等待 15 秒政策，並加入 429、503 的退避與 Retry-After；同次搜尋切換來源不跳過 cooldown。跨請求／跨 endpoint 持久 cooldown 尚未實作，preview 原本的 retry 行為保持不變。

離線測試（含新 API、既有 preview 回歸）：

```powershell
.\research\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
```

`test_epochs.py` 以合成 VOTable 覆蓋合併、分頁、篩選、嚴格輸入、OVERFLOW、來源失敗、快取、cursor、鎖及 429／503。另可選擇性回放本機 Phase 4.1 XML，核對 428 產品／217 曝光／215 個中心覆蓋曝光；沒有研究輸出時只跳過此回放，其餘測試獨立可跑。

## Phase 4.4：多時期影格 API

`POST /api/epoch-frames` 僅接受既有搜尋的 `search_id` 與 **2～3 個不同的 `product_id`**，不接受 URL、座標、grid 或其他額外欄位。同一組只能選相同且已知的 detector。輸出順序與請求相同，不會換曝光補位；不修改原有 preview／epochs search 的契約。

```json
{"search_id":"搜尋回應的 search_id","product_ids":["第一個 product_id","第二個 product_id"]}
```

在既有服務啟動後，可用以下 PowerShell **實際呼叫 NASA**（離線驗證使用下方 unittest，不執行此段）。先檢視候選，再明確填入選定的 2～3 個 ID；不要將「前兩筆」當成已驗證同波長。

```powershell
$base = 'http://127.0.0.1:8000'
$query = @{ra=127.69444; dec=-39.17760; radius_deg=0.01; detectors=@(1); limit=100} | ConvertTo-Json
$search = Invoke-RestMethod "$base/api/epochs/search" -Method Post -ContentType 'application/json' -Body $query
$search.products | Select-Object product_id,obs_id,detector,t_min,obs_collection
$chosen = @('貼上第一個 product_id', '貼上第二個 product_id')
$body = @{search_id=$search.search_id; product_ids=$chosen} | ConvertTo-Json
$sequence = Invoke-RestMethod "$base/api/epoch-frames" -Method Post -ContentType 'application/json' -Body $body
$sequence | ConvertTo-Json -Depth 25
Invoke-WebRequest $sequence.frames[0].image_url -OutFile frame-0.png
Invoke-WebRequest $sequence.frames[0].data_url -OutFile frame-0.npz
```

若候選在後續頁面，沿用 epochs search 的 cursor 取得；product 必須屬於同一份 snapshot。`search_id` 過期／淘汰／服務重啟回 **410 `search_expired`**，即使影格快取仍存在也需重新搜尋。選到外部產品回 422 `invalid_product`，混 detector 回 422 `detector_mismatch`，來源 URL／產品 hash 不符回 422 `invalid_product_source`。格式或額外欄位回既有 422 `invalid_input`（其共用提示仍沿用原文）。工作鎖忙碌回 503 `busy`、`Retry-After: 5`；序列超出快取容量回 503 `frame_capacity`。

HTTP 200 的內容：

- `sequence_id`、`search_id`、`policy_version=phase4.4-v1`、`expires_at`、`expires_in_seconds`、`counts`、本次 `nasa_request_count`。`complete` 只代表所有指定產品都完成重投影，不保證品質／對齊／波長合格；全部 slot 失敗仍回 200 並逐一揭露原因。
- `grid`：以搜尋的 ICRS 中心建立固定 TAN、29×29、6.15 arcsec/pixel、北上東左格網，FITS CRPIX=(15,15)。保留原來 3arcmin Cutout，不為旋轉缺角下載更大視窗。
- `frames`：保留 index、product_id、obs_id、detector、來源 collection(s)／URL／版本、原始 SIA MJD；成功時另有 DATE-OBS、UTC／time_source、波長／bandwidth（µm）、WCS 幾何閉合、FLAGS 定義、品質與中心有效性、calibration HISTORY、FITS SHA-256。時間優先讀 FITS UTC DATE-OBS，缺欄時明示回退 SIA；明示非 UTC 的 FITS 保守拒絕。
- `geometry.status` 與 `alignment.status` 分開：閉合誤差需 <1e-5 pixel；星點相對殘差至少 3 對、median <0.5、maximum <1 pixel。全部成功影格兩兩檢查，不足為 `unverified`，超標或中心／幾何失敗為 `failed`；slot 為 `alignment_unqualified`，仍可檢視診斷影格，不宣稱對齊合格。完整配對診斷在 `pair_checks`。
- `mode=comparable_visualization` 僅於所有 slot 成功、全部兩兩波長相容、校準 provenance 相容、中心／對齊通過且有共同有效區時成立。波長政策：Δλ ≤ 0.1 × min(bandwidth)，bandwidth 相對差 ≤ 0.1；alternate W 手動 -TAB 插值需通過 WCSLIB 核心交叉核對，不能套 spatial SIP。校準採 v27、相同非空 pipeline／CALIB HISTORY 與單位的保守政策。
- 可比較組取共同有效區合併 p1/p99，固定相同 lo/hi 與 asinh(10x)；其他組為 `mode=observation_browse`，逐張 stretch 並明示。`normalization` 與每張實際範圍均回傳；`photometric_series` **永遠為 false**。目標位置相容不代表整個視場波段一致，不提供光變推論。
- 下載／解析失敗保留原 slot、`status=failed`、`error.code/message/http_status/budget_stop_reason`，URL 為 null。成功重投影的 slot 提供 `image_url` 及 `data_url`。

`GET /api/epoch-frames/{sequence_id}/{index}.png` 回 29×29 RGBA PNG，無效 pixel 的 alpha=0；上下翻轉僅供北上顯示。`{index}.npz` 為 NumPy 壓縮資料（`np.load(path, allow_pickle=False)`）：`native_image` 保留原始 IMAGE 的值／dtype／NaN、`native_flags` 保留完整 bit 值（uint64）、`native_valid`；另有 `aligned_image`（float32、無效值 NaN）、`valid_mask`、`valid_weight`、`geometric_weight`、`flags_or`、原生及輸出 WCS header。NPZ 陣列未上下翻轉；零基中心為 (14,14)。`flags_or=0` 不代表有效，必須併用 mask／幾何資訊。

Technical definitions for the public brightness and quality help:

- Preview (`research/spherex.py:render_cutout`) permits a missing FLAGS extension: its pixel mask is then `isfinite(IMAGE)`, with no flag-based quality assurance. FITS/IMAGE structure and size, nonempty finite data, celestial WCS, target coverage and a finite target pixel, and a representable display range are still checked. Present FLAGS must match IMAGE dimensions and have integer values; Preview rejects bits 1, 2, 6, 9, 15 and 19. A finite target pixel carrying a rejected bit is reported as `target_valid=false`, rather than necessarily rejecting the whole Preview.
- Multi-epoch requires FLAGS, matching shape and sampled WCS, integer masks, and nonempty header definitions. `native_valid` requires finite IMAGE values and no set bits outside the header-declared SOURCE/FULLSAMPLE masks.
- `frame_math.bilinear` uses the four bilinear interpolation coefficients. `geometric_weight` sums coefficients for in-bounds pixels; `valid_weight` sums coefficients for in-bounds pixels passing `native_valid`. These are interpolation coverage weights, not uncertainty weights. Both sums must be at least `1 - 1e-6` for an output to be retained; otherwise the output is NaN. The weighted sum is not renormalized to fill missing support. `valid_mask` is `isfinite(aligned_image)` after conversion to float32.
- `flags_or` is the bitwise OR of in-bounds input masks whose interpolation coefficient is greater than `1e-8`, regardless of `native_valid`. It can therefore include rejected inputs and exists even for invalid outputs. Zero flags do not prove coverage or finite data; use `valid_mask` for output validity and the two coverage arrays for diagnostics.
- Frontend Preview and Multi-epoch both use `SpherexBrightness.rgba`: clip values to Min/Max, normalize to `t = (value - Min)/(Max - Min)` in [0, 1], then apply Log as `log1p(1000*t)/log1p(1000)`. This supports finite zero and negative input brightness without taking their logarithm directly. Masked/non-finite values remain transparent. Histograms use original valid native IMAGE values (Multi-epoch replaces the aligned display histogram with the native histogram); display controls do not modify science values, masks or histogram counts.

所有非零權重的雙線性支撐像素必須有效；FLAGS 只允許 SOURCE／FULLSAMPLE 資訊位，其餘已知／未知位均拒絕。FLAGS 與 IMAGE shape／抽樣 WCS 需相符。原始 FITS 唯讀、逐張下載／關閉，不保留 HDU 或展開 EPSF。限制 IMAGE／FLAGS 每軸 ≤128、波長表固定欄位 ≤1 MiB，IMAGE 單位必須是 MJy/sr（不更動原始值）。

與 preview／新 metadata search 共用鎖；每組最多 16 次 HTTP 嘗試、120 秒協作期限、20 秒 socket timeout、每 URL 三次，429／503 遵守 Retry-After 與跨 slot cooldown，等待 >15 秒或超過剩餘預算則停止其餘下載。為避免未計數請求與任意來源，**不跟隨任何 HTTP redirect**；不回退完整母影像。這些是專案上限，不是 NASA 公告配額，也不是硬性 DNS／OS 牆鐘保證。

序列快取獨立上限 **8 MiB／16 組**（manifest+所有 PNG+NPZ 序列化 bytes），與既有 PNG 16 MiB、metadata 8 MiB 合計 ≤32 MiB 序列化 payload；不是 RSS 保證。成功重投影全組 TTL 600 秒，含失敗 slot 為 60 秒，讀取不延長到期。manifest／blob 整組 FIFO 淘汰，blob 過期回 404 `frame_not_found`。同 snapshot、同順序選取、同政策版本命中零新請求；反轉順序視為另一組。快取命中可在鎖忙時回傳。`expires_at` 為權威時間，`expires_in_seconds` 是建立時 TTL。

本輪不增加跨請求／跨 endpoint 的持久 NASA cooldown；既有 preview 行為維持原樣。不同選取或到期後重試仍可能發出新請求；請勿當成批次下載服務。記憶體快取僅限單 worker，重啟即失效。未實作前端、時間軸、動畫或 Phase 4.5。

離線驗證（不下載新 NASA 資料）：

```powershell
$env:SPHEREX_LIVE = '0'
.\research\.venv\Scripts\python.exe -m unittest backend.tests.test_epoch_frames -v
.\research\.venv\Scripts\python.exe -m unittest discover -s backend/tests
```

合成 FITS 核心測試不依賴研究輸出；本機 Phase 4.2 FITS 回放在缺檔時跳過。結果與尚未驗證項目見 [Phase 4.4 報告](phase4-4-report.md)。

## CORS 設定

啟動前可設定以逗號分隔的完整 origins，不能包含路徑或尾端斜線：

```powershell
$env:CORS_ORIGINS = 'http://localhost:5500,http://127.0.0.1:5500,https://YOUR_ACCOUNT.github.io'
```

未設定時允許 localhost:5500、127.0.0.1:5500、localhost:5173。使用明確允許清單與 `allow_credentials=False`；不使用萬用 origin。[FastAPI 官方 CORS 文件](https://fastapi.tiangolo.com/tutorial/cors/)

## 測試

在專案根目錄安裝測試依賴後執行。`requirements-dev.txt` 也會引用正式依賴；一般啟動只需 `requirements.txt`。

```powershell
.\research\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
.\research\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
$env:SPHEREX_LIVE = '1'
.\research\.venv\Scripts\python.exe -m unittest backend.tests.test_api.ApiTests.test_live_nasa -v
Remove-Item Env:SPHEREX_LIVE
```

預設測試不連線 NASA：使用 Phase 1 的真實 VOTable/FITS 回放，實際執行共用解析、WCS、轉圖及 PNG 端點，再與 Phase 1 PNG 像素比對；另測輸入、錯誤、CORS、快取與併發限制。QR3 fallback 測試使用刻意建立的測試 VOTable。真實檔案不存在時回放會 skip。live 測試才真正呼叫 NASA，結果寫至 `backend/test-results/`。測試採用 [FastAPI TestClient](https://fastapi.tiangolo.com/tutorial/testing/)。

## Render 部署準備（Phase 5.1）

正式部署入口為 repository 根目錄執行 `python -m backend.start`，固定單一 worker、不啟用 reload，監聽 `0.0.0.0` 與環境變數 `PORT`。部署使用 `backend/requirements-render.txt`。

完整設定、環境變數與 Render 免費方案風險見 [DEPLOYMENT.md](DEPLOYMENT.md)，離線驗證結果見 [phase5-1-report.md](phase5-1-report.md)。本輪未實際部署。

## 共用程式碼

`research/spherex.py` 從成功的 `verify_spherex.py` 抽出 `fetch`、`query_images`、`build_cutout_url`、`render_cutout`；CLI 與後端皆呼叫同一份函式。保留原 SIA collection、查詢格式、3arcmin 預設、HDU 檢查、百分位/asinh 與灰階反轉算法；Preview service 僅傳遞受控尺寸及補充天區 metadata。後端不呼叫 CLI 的 `main()`，不覆寫 Phase 1 輸出或報告，也不使用可變全域座標／目錄處理請求。
