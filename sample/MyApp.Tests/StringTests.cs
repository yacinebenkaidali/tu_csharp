using Xunit;

namespace MyApp.Tests;

public class StringTests
{
    [Fact]
    public void Concat_ReturnsCombinedString()
    {
        var result = "Hello" + " " + "World";
        Assert.Equal("Hello World", result);
    }

    [Theory]
    [InlineData("hello", "HELLO")]
    [InlineData("World", "WORLD")]
    public void ToUpper_ReturnsUppercaseString(string input, string expected)
    {
        Assert.Equal(expected, input.ToUpper());
    }

    [Fact]
    public void IsNullOrEmpty_WithNull_ReturnsTrue()
    {
        Assert.True(string.IsNullOrEmpty(null));
    }

    [Fact]
    public void IsNullOrEmpty_WithValue_ReturnsFalse()
    {
        Assert.False(string.IsNullOrEmpty("value"));
    }
}
