function generateCaptcha() {
  const operations = ['+', '-', '*'];
  const num1 = Math.floor(Math.random() * 10) + 1;
  const num2 = Math.floor(Math.random() * 10) + 1;
  const operation = operations[Math.floor(Math.random() * operations.length)];
  
  let answer;
  switch(operation) {
    case '+': answer = num1 + num2; break;
    case '-': answer = num1 - num2; break;
    case '*': answer = num1 * num2; break;
  }
  
  return {
    question: `${num1} ${operation} ${num2}`,
    answer: answer.toString()
  };
}

function verifyCaptcha(userAnswer, correctAnswer) {
  return userAnswer.trim() === correctAnswer;
}

module.exports = { generateCaptcha, verifyCaptcha };