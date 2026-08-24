const emailInput = document.getElementById("email-input");
const emailForm = document.querySelector(".email-form");

if (emailInput && emailForm) {
  emailForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const link = `https://docs.google.com/forms/d/e/1FAIpQLSdC-kvfT5vp0ITUdxSZDyJYExJvkep9kQ4SNvL68xFr8jwW9w/viewform?usp=pp_url&entry.1045781291=${encodeURIComponent(emailInput.value)}`;
    window.open(link);
  });
}
