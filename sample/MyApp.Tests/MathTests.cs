using Xunit;

namespace MyApp.Tests;

public class MathTests
{
    [Fact]
    public void Add_ReturnsSumOfTwoNumbers()
    {
        var result = 2 + 3;
        Assert.Equal(5, result);
    }

    [Fact]
    public void Subtract_ReturnsCorrectDifference()
    {
        var result = 10 - 4;
        Assert.Equal(6, result);
    }

    [Theory]
    [InlineData(2, 3, 6)]
    [InlineData(0, 100, 0)]
    [InlineData(-1, 5, -5)]
    public void Multiply_ReturnsCorrectProduct(int a, int b, int expected)
    {
        Assert.Equal(expected, a * b);
    }

    [Fact]
    public void Divide_ByZero_ThrowsException()
    {
        Assert.Throws<DivideByZeroException>(() => _ = 10 / 0);
    }
}
