# コードの色付け

TypeScript:

```ts
// コメント
const greeting: string = "hello";
function add(a: number, b: number): number {
	return a + b;
}
```

Python:

```python
def fib(n):
    """docstring"""
    return n if n < 2 else fib(n - 1) + fib(n - 2)
```

JSON:

```json
{ "name": "batch-office-export", "version": 3, "ok": true }
```

Bash:

```bash
npm run build && echo "done"
```

言語が分からないもの（色なし）:

```unknownlang
some text
```

言語の指定なし:

```
plain text
```

インラインコード `const x = 1` は色を付けない。
