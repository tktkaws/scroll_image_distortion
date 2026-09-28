# Scroll Image Distortion

スクロール速度に応じて、カード一覧の画像が上下に歪む UI デモです。

DOM 上に通常のカード型リンクを並べ、見た目上の画像は固定フルスクリーンの WebGL（Three.js）で描画します。歪み処理のシェーダーは `Mouse_Image_Distortion_02` を流用し、駆動源をマウス差分からスクロール速度に差し替えています。

## 使用技術

- Astro
- Three.js
- GLSL シェーダー
- Tweakpane（パラメータ調整 UI）

## 起動方法

```sh
npm install
npm run dev
```

ブラウザで `http://localhost:4321` を開きます。

| Command | Action |
| :------ | :----- |
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | 本番ビルド |
| `npm run preview` | ビルド結果のプレビュー |

## ファイル構成

```txt
scroll_image_distortion/
├─ public/images/          # カード画像（1.jpg〜7.jpg）
├─ src/
│  ├─ pages/
│  │  └─ index.astro       # カード一覧 HTML + スタイル
│  └─ scripts/
│     ├─ data.js           # タイトル / 画像パス / リンク
│     ├─ shaders.js        # 頂点・フラグメントシェーダー
│     └─ main.js           # Three.js・スクロール連動・Tweakpane
└─ package.json
```

## 全体の仕組み

```txt
スクロール速度（scrollDelta）
        ↓
   uDelta（クランプ付き）
        ↓
  頂点シェーダーで平面を歪める
        ↑
  各カードの .card-media 位置
  （getBoundingClientRect で同期）
```

1. HTML 側にカード（画像エリア + タイトル）を 2 列で並べる
2. `#webgl-stage` に 1 枚の Canvas を固定配置する（`pointer-events: none`）
3. 各 `.card-media` に対応する Plane メッシュを作り、毎フレーム DOM 位置へ同期する
4. スクロール差分を `uDelta` に渡し、シェーダーで上下方向に歪ませる

Canvas が画面全体を覆っていてもクリックは下の HTML に届くため、カードリンクはそのまま使えます。

---

## `src/pages/index.astro`

ページの土台です。

- `data.js` の `projects` からカード一覧を生成
- カード全体を `<a class="card">` にする（上が画像、下がテキスト）
- `#webgl-stage` を固定オーバーレイとして配置
- `main.js` を client スクリプトとして読み込み

```html
<a class="card" href="#">
  <div class="card-media" data-src="/images/5.jpg" data-title="...">
    <img src="/images/5.jpg" alt="..." />
  </div>
  <p class="card-title">タイトル</p>
</a>

<div id="webgl-stage"></div>
```

`data-src` / `data-title` は WebGL 側がテクスチャ読み込みに使います。  
`<img>` はフォールバック兼レイアウト用で、テクスチャ読み込み後に `opacity: 0` にしてチラつきを防ぎます。

レイアウトは CSS Grid の 2 列です。狭い画面では 1 列に戻します。

---

## `src/scripts/data.js`

カードのメタデータを管理します。

```js
export const projects = [
  {
    title: "Richard Gaston",
    src: "/images/5.jpg",
    href: "#",
  },
];
```

カードを増やすときは、この配列にオブジェクトを追加し、対応する画像を `public/images/` に置きます。

---

## `src/scripts/shaders.js`

画像を歪ませる GLSL です。`Mouse_Image_Distortion_02` と同じ式を使っています。

### 頂点シェーダー

```glsl
newPosition.x += sin(uv.y * PI) * uDelta.x * uAmplitude;
newPosition.y += sin(uv.x * PI) * uDelta.y * uAmplitude;
```

| Uniform | 意味 |
| :------ | :--- |
| `uDelta` | スクロール速度（本デモでは主に Y） |
| `uAmplitude` | 歪みの強さ |
| `uv` | 平面上の位置（0〜1） |

`sin(...)` により、端はあまり動かず中央ほど大きく曲がる波状の歪みになります。  
本デモではスクロールで `uDelta.y` を更新するため、画像が上下に歪みます。

### フラグメントシェーダー

```glsl
vec3 texture = texture2D(uTexture, vUv).rgb;
gl_FragColor = vec4(texture, uAlpha);
```

テクスチャ色を描画します。`uAlpha` は常時表示のため基本 `1` です。

---

## `src/scripts/main.js`

デモの中心です。

### 1. Three.js の初期化

- `WebGLRenderer`（透明背景）
- `PerspectiveCamera`（FOV 75、`z = 5`）
- 画面全体サイズの Canvas を `#webgl-stage` に追加

### 2. カードごとの Plane 生成（`createItem`）

各 `.card-media` に対して次を作成します。

- `PlaneGeometry(1, 1, 15, 15)` … 分割数を上げて頂点変形を滑らかに
- `ShaderMaterial` … 上記シェーダー + uniforms
- テクスチャ読み込み（失敗時は Canvas のプレースホルダー）

```js
const uniforms = {
  uDelta: { value: new THREE.Vector2(0, 0) },
  uAmplitude: { value: params.amplitude },
  uTexture: { value: placeholder },
  uAlpha: { value: 1 },
};
```

### 3. DOM 位置への同期（`syncMeshToElement`）

毎フレーム `getBoundingClientRect()` でカード画像エリアの位置・サイズを取得し、Three.js のワールド座標へ変換します。

- 画面外のメッシュは `visible = false`
- 中心位置 → `mesh.position`
- 幅・高さ → `mesh.scale`

これにより、スクロールやリサイズでも WebGL 画像が HTML カードに追従します。

### 4. スクロール連動の歪み

```js
const rawDelta = currentScrollY - previousScrollY;
smoothScrollDelta = clamp(
  lerp(smoothScrollDelta, rawDelta, 0.35),
  -params.maxDelta,
  params.maxDelta,
);
```

- `rawDelta` … 直前フレームとのスクロール差分
- `lerp` … 急な変化をなめらかに
- `clamp` … **歪みの上限**（`maxDelta`）

アニメーションループでは符号を反転して渡しています（見た目の歪み方向を逆にするため）。

```js
item.uniforms.uDelta.value.set(0, -smoothScrollDelta);
```

スクロールが止まると `uDelta` を `0.92` 倍して減衰させ、歪みが徐々に戻ります。

### 5. Tweakpane

画面右上で次の値をリアルタイム調整できます。

| パラメータ | デフォルト | 内容 |
| :--------- | ---------: | :--- |
| `maxDelta` | `20` | スクロール差分の上限（歪みの頭打ち） |
| `amplitude` | `0.002` | シェーダー側の歪み倍率 |

### 6. カードクリック

カードリンクをクリックすると、ページ先頭へスムーズスクロールします。  
その際 `smoothScrollDelta` をリセットし、ジャンプ時の過大な歪みを防ぎます。

---

## 調整のポイント

- **歪みが強すぎる** → `maxDelta` を下げる、または `amplitude` を下げる
- **歪みが弱い** → それぞれ上げる
- **歪みの向きを変えたい** → `uDelta.value.set(0, -smoothScrollDelta)` の符号を外す／付ける
- **カード数を増やす** → `data.js` に追加し、画像を `public/images/` に置く

## 参考

歪みシェーダーと Three.js の基本構成は、同ワークスペースの `Mouse_Image_Distortion_02`（マウス追従版）をベースにしています。違いは次のとおりです。

| Mouse_Image_Distortion_02 | 本プロジェクト |
| :------------------------ | :------------- |
| 平面 1 枚がマウス追従 | カード数ぶんの平面を DOM 同期 |
| マウス移動差分 → `uDelta` | スクロール差分 → `uDelta` |
| ホバーでフェード表示 | カード画像は常時表示 |
