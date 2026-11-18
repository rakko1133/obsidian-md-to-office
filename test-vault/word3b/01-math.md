# 数式

## インライン

質量とエネルギーの関係 $E = mc^2$ と、ギリシャ文字 $\alpha + \beta = \gamma$。下付きの $a_{ij}$ と上付きの $x^{n+1}$。

## ブロック

二次方程式の解:

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

総和と積分:

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}, \qquad \int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}
$$

極限:

$$
\lim_{x \to 0} \frac{\sin x}{x} = 1
$$

## 行列・場合分け・揃え

$$
A = \begin{pmatrix} a & b \\ c & d \end{pmatrix}, \quad I = \begin{bmatrix} 1 & 0 \\ 0 & 1 \end{bmatrix}
$$

$$
f(x) = \begin{cases} 1 & x > 0 \\ 0 & \text{それ以外} \end{cases}
$$

$$
\begin{aligned}
(a + b)^2 &= a^2 + 2ab + b^2 \\
(a - b)^2 &= a^2 - 2ab + b^2
\end{aligned}
$$

## 記号

$$
\nabla \cdot \mathbf{E} = \frac{\rho}{\varepsilon_0}, \quad \hat{x}, \ \vec{v}, \ \overline{AB}, \ \mathbb{R}^n
$$

## Word の数式にできない式（画像になって警告）

$$
\sideset{_1^2}{_3^4}\sum_{k} a_k
$$

二項係数の別の書き方 $\genfrac{(}{)}{0pt}{}{n}{k}$ も画像になる。

## どちらでも変換できない式（LaTeX のまま残って警告）

$$
\undefinedcommand{x}
$$

## 数式でないもの

コードの中の `$x$` と、金額 100 円 は数式にしない。
