package androidx.compose.ui.text.font
class FontFamily {
    companion object { val Default = FontFamily(); val Monospace = FontFamily() }
}
class FontWeight(val weight: Int) {
    companion object { val Light = FontWeight(300); val Normal = FontWeight(400); val Medium = FontWeight(500); val SemiBold = FontWeight(600); val Bold = FontWeight(700); val ExtraBold = FontWeight(800) }
}
