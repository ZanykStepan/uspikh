export async function request(
  path,
  { method = "GET", body, signal } = {},
) {
  let response;
  try {
    response = await fetch("/api" + path, {
      method,
      signal,
      headers: { "Content-Type": "application/json", ...(sessionStorage.getItem("uspikh-token") ? { Authorization: `Bearer ${sessionStorage.getItem("uspikh-token")}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(
      "Немає зв’язку із сервером. Перевірте з’єднання та повторіть спробу.",
    );
  }
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message || "Не вдалося виконати запит.");
  return data;
}
