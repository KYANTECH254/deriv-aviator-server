// sanitizeInput.js
exports.sanitizeInput = (input) => {
    if (!input || typeof input !== 'string') return null; // Ensure input is a string
    return input.replace(/[^\w\s.-]/gi, ""); // Remove all non-word, non-space, non-period, and non-hyphen characters
};

// validateParams.js
exports.validateParams = (apiKey, platformId) => {
    if (!apiKey || !platformId) {
        return false; // Missing required parameters
    }

    // Check if API key is exactly 64 characters
    if (apiKey.length !== 64) {
        return false; // Invalid API key format
    }

    // Check if Platform ID is exactly 32 characters
    if (platformId.length !== 32) {
        return false; // Invalid Platform ID format
    }

    return true; // Both API key and Platform ID are valid
};

// generateUsername.js
exports.generateUsername = (num) => {
    if (typeof num !== 'string' || num.length === 0) {
        return null; // Handle cases where the input is not a string or is empty
    }

    const lastDigit = num.slice(-1); // Get the last digit of the string
    return `2***${lastDigit}`; // Return the formatted username
};
