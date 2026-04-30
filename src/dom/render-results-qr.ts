import { renderQR } from "./render-qr";
import { html, type Child } from "./html";
import { formatQuizUrlDisplay } from "../quiz-url";

/**
 * Render a compact QR code block for results slides.
 * Gives latecomers a chance to scan and vote while results are showing.
 */
export async function renderResultsQR(
  quizUrl: string | undefined,
  slide: HTMLElement,
): Promise<Child> {
  if (!quizUrl) return null;

  const qrImg = await renderQR(quizUrl, 160, slide);

  return html`
    <div class="sq-results__qr-side">
      ${qrImg}
      <p class="sq-results__qr-url">
        ${formatQuizUrlDisplay(quizUrl)}
      </p>
    </div>
  `;
}
