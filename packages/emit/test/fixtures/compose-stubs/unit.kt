package androidx.compose.ui.unit
class Dp(val value: Float)
class TextUnit(val value: Float)
val Number.dp: Dp get() = Dp(this.toFloat())
val Number.sp: TextUnit get() = TextUnit(this.toFloat())
val Number.em: TextUnit get() = TextUnit(this.toFloat())
