# Coding Standards

## TypeScript Guidelines

### General Principles
- Use TypeScript strict mode
- Prefer `const` over `let` when values don't change
- Always specify return types for functions
- Use meaningful variable and function names

### Code Style
- Use 2 spaces for indentation
- Use single quotes for strings
- Add semicolons at the end of statements
- Maximum line length: 120 characters

### Type Definitions
- Avoid using `any` type unless absolutely necessary
- Prefer interfaces over type aliases for object shapes
- Use enums for fixed sets of values
- Document complex types with JSDoc comments

### Error Handling
- Always handle promises with try/catch or .catch()
- Throw Error objects, not strings
- Log errors with appropriate context
- Use custom error classes for domain-specific errors

### Testing
- Write unit tests for all business logic
- Maintain at least 80% code coverage
- Use descriptive test names
- Mock external dependencies

### Git Commit Messages
- Use conventional commit format: `type: description`
- Types: feat, fix, docs, style, refactor, test, chore
- Keep the first line under 72 characters
- Add detailed description in the body when needed

## Code Review Checklist
- [ ] Code follows TypeScript best practices
- [ ] Proper error handling is implemented
- [ ] Code is well-documented
- [ ] Tests are included for new functionality
- [ ] No sensitive data is exposed
- [ ] Performance implications are considered